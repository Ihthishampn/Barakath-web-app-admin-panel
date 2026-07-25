import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import 'wallet.dart';

/// Reads the customer's wallet + ledger (direct owner-scoped Firestore reads)
/// and drives the Razorpay-funded top-up via the `topUpWallet`/`verifyTopUp`
/// Cloud Functions (asia-south1) — the balance/breakdown/ledger writes are all
/// Admin-SDK only, so the app never writes wallet money directly.
class WalletRepository {
  WalletRepository({FirebaseFirestore? db, FirebaseFunctions? functions})
      : _db = db ?? FirebaseFirestore.instance,
        _fn = functions ??
            FirebaseFunctions.instanceFor(region: 'asia-south1');
  final FirebaseFirestore _db;
  final FirebaseFunctions _fn;

  /// Live wallet balance + breakdown from the customer doc.
  Stream<Wallet> watchWallet(String uid) => _db
      .doc('customers/$uid')
      .snapshots()
      .map((s) => Wallet.fromCustomer(s.data()));

  /// Live ledger, newest first (single-field orderBy → no composite index).
  Stream<List<WalletTransaction>> watchTransactions(String uid, {int limit = 50}) =>
      _db
          .collection('customers/$uid/walletTransactions')
          .orderBy('createdAt', descending: true)
          .limit(limit)
          .snapshots()
          .map((s) => s.docs.map(WalletTransaction.fromDoc).toList());

  /// Lifetime credit totals behind the Rewards and Cashback tiles, summed from
  /// the actual ledger by `source` so each tile shows exactly one earning path:
  ///   Rewards  = Spin Wheel winnings        → source 'spin_reward'
  ///   Cashback = admin coupon-campaign bonus → source 'cashback'
  ///
  /// Deliberately separate from [watchTransactions] (which caps at 50 rows for
  /// the history list): the totals must sum the WHOLE ledger, not just the most
  /// recent page. Filtered to credits only — a single-field `where`, no
  /// composite index. Mirrors the web wallet page's client-side sum.
  Stream<({int spinReward, int cashback})> watchCreditTotals(String uid) => _db
      .collection('customers/$uid/walletTransactions')
      .where('type', isEqualTo: 'credit')
      .snapshots()
      .map((s) {
        var spin = 0;
        var cash = 0;
        for (final d in s.docs) {
          final data = d.data();
          final amt = (data['amountPaise'] as num?)?.toInt() ?? 0;
          switch (data['source']) {
            case 'spin_reward':
              spin += amt;
            case 'cashback':
              cash += amt;
          }
        }
        return (spinReward: spin, cashback: cash);
      });

  /// Open a Razorpay order for a wallet top-up. `amountPaise` must be ≥ ₹100.
  /// Throws [FirebaseFunctionsException] with a user-facing message on invalid
  /// amounts or gateway failures.
  Future<TopUpOrder> startTopUp(int amountPaise) async {
    final res = await _fn
        .httpsCallable('topUpWallet')
        .call<Map<String, dynamic>>({'amountPaise': amountPaise});
    return TopUpOrder(
      razorpayOrderId: (res.data['razorpayOrderId'] as String?) ?? '',
      keyId: (res.data['keyId'] as String?) ?? '',
      amountPaise: (res.data['amountPaise'] as num?)?.toInt() ?? amountPaise,
    );
  }

  /// Verify the gateway signature server-side; on success the wallet is credited
  /// and a ledger row is written. Returns whether the credit went through.
  Future<bool> verifyTopUp({
    required String razorpayOrderId,
    required String razorpayPaymentId,
    required String razorpaySignature,
  }) async {
    final res = await _fn
        .httpsCallable('verifyTopUp')
        .call<Map<String, dynamic>>({
      'razorpayOrderId': razorpayOrderId,
      'razorpayPaymentId': razorpayPaymentId,
      'razorpaySignature': razorpaySignature,
    });
    return (res.data['credited'] as bool?) ?? false;
  }

  /// Best-effort status check for a top-up whose result never reached the
  /// client (the Razorpay activity was killed while the app was
  /// backgrounded). Returns the raw `pendingPayments` status —
  /// `'captured'` once credited, `'pending'` otherwise.
  Future<String> fetchTopUpStatus(String razorpayOrderId) async {
    final res = await _fn
        .httpsCallable('getTopUpStatus')
        .call<Map<String, dynamic>>({'razorpayOrderId': razorpayOrderId});
    return (res.data['status'] as String?) ?? 'pending';
  }
}

/// A pending Razorpay top-up order returned by `topUpWallet`.
class TopUpOrder {
  const TopUpOrder({
    required this.razorpayOrderId,
    required this.keyId,
    required this.amountPaise,
  });
  final String razorpayOrderId;
  final String keyId;
  final int amountPaise;
}
