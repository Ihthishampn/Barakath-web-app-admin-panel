import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import 'affiliate_models.dart';

/// Minimum + fee settings for withdrawals (`settings/affiliate`), mirroring the
/// web `withdrawalFeePaise` math so the app previews the same net payout.
class AffiliateSettings {
  const AffiliateSettings({
    this.minWithdrawalPaise = 0,
    this.processingFeeType = 'fixed',
    this.processingFeeValue = 0,
    this.processingFeeMinPaise = 0,
  });

  final int minWithdrawalPaise;
  final String processingFeeType; // 'fixed' | 'percent'
  final int processingFeeValue;
  final int processingFeeMinPaise;

  int feePaise(int amountPaise) {
    final raw = processingFeeType == 'percent'
        ? (amountPaise * processingFeeValue / 100).round()
        : processingFeeValue;
    return raw > processingFeeMinPaise ? raw : processingFeeMinPaise;
  }

  int netPayoutPaise(int amountPaise) {
    final n = amountPaise - feePaise(amountPaise);
    return n < 0 ? 0 : n;
  }
}

/// Result of an IFSC lookup — powers the "verified from IFSC" card.
class IfscInfo {
  const IfscInfo({required this.bank, required this.branch, required this.city});
  final String bank;
  final String branch;
  final String city;
}

/// Reads affiliate data (customer.affiliate, bankAccounts, commissions,
/// withdrawalRequests) and performs the writes the app is allowed to make:
/// managing bank accounts (direct Firestore writes on the `bankAccounts` array
/// — rules permit the owner, capped at 5) and requesting a withdrawal (the
/// `requestWithdrawal` Cloud Function). All money mutations (balances,
/// withdrawal status) stay server-authoritative.
class AffiliateRepository {
  AffiliateRepository({FirebaseFirestore? db, FirebaseFunctions? functions})
      : _db = db ?? FirebaseFirestore.instance,
        _fn = functions ??
            FirebaseFunctions.instanceFor(region: 'asia-south1');

  final FirebaseFirestore _db;
  final FirebaseFunctions _fn;

  DocumentReference<Map<String, dynamic>> _customer(String uid) =>
      _db.doc('customers/$uid');

  /// Live affiliate block for the customer.
  Stream<AffiliateInfo?> watchAffiliate(String uid) =>
      _customer(uid).snapshots().map((s) => AffiliateInfo.fromCustomer(s.data()));

  /// Live saved payout accounts.
  Stream<List<BankAccount>> watchBanks(String uid) =>
      _customer(uid).snapshots().map((s) => BankAccount.listFrom(s.data()));

  /// The customer's own commission ledger, newest first. Queried by equality
  /// only (no orderBy) and sorted client-side, so no composite index is needed
  /// — matching the web.
  Stream<List<Commission>> watchCommissions(String uid) => _db
      .collection('commissions')
      .where('affiliateUid', isEqualTo: uid)
      .snapshots()
      .map((s) {
        final list = s.docs.map(Commission.fromDoc).toList();
        list.sort((a, b) => (b.accruedAt ?? DateTime(0))
            .compareTo(a.accruedAt ?? DateTime(0)));
        return list;
      });

  /// The customer's own withdrawal requests, newest first (client-sorted).
  Stream<List<WithdrawalRequest>> watchWithdrawals(String uid) => _db
      .collection('withdrawalRequests')
      .where('customerId', isEqualTo: uid)
      .snapshots()
      .map((s) {
        final list = s.docs.map(WithdrawalRequest.fromDoc).toList();
        list.sort((a, b) => (b.createdAt ?? DateTime(0))
            .compareTo(a.createdAt ?? DateTime(0)));
        return list;
      });

  Future<AffiliateSettings> settings() async {
    final snap = await _db.doc('settings/affiliate').get();
    final d = snap.data() ?? const <String, dynamic>{};
    int i(String k) => (d[k] as num?)?.toInt() ?? 0;
    return AffiliateSettings(
      minWithdrawalPaise: i('minWithdrawalPaise'),
      processingFeeType: (d['processingFeeType'] as String?) ?? 'fixed',
      processingFeeValue: i('processingFeeValue'),
      processingFeeMinPaise: i('processingFeeMinPaise'),
    );
  }

  /// Bank names keyed by the 4-letter IFSC bank code. OFFLINE FALLBACK ONLY —
  /// used when the real directory below can't be reached, never as validation.
  static const _ifscBanks = {
    'HDFC': 'HDFC Bank',
    'ICIC': 'ICICI Bank',
    'SBIN': 'State Bank of India',
    'UTIB': 'Axis Bank',
    'KKBK': 'Kotak Mahindra Bank',
    'PUNB': 'Punjab National Bank',
    'BARB': 'Bank of Baroda',
    'CNRB': 'Canara Bank',
    'IDIB': 'Indian Bank',
    'IOBA': 'Indian Overseas Bank',
    'YESB': 'Yes Bank',
    'INDB': 'IndusInd Bank',
    'FDRL': 'Federal Bank',
    'UBIN': 'Union Bank of India',
    'MAHB': 'Bank of Maharashtra',
  };

  /// Resolve an IFSC to its real bank and branch.
  ///
  /// Uses Razorpay's public IFSC directory (`ifsc.razorpay.com/<IFSC>`) — free,
  /// unauthenticated, no account or key required. This replaces a prefix-map
  /// guess that reported ANY well-formed string as "Verified", so a typo'd or
  /// invented IFSC was accepted and saved against a payout account.
  ///
  /// A 404 now correctly means "no such IFSC" and returns null, which the form
  /// already treats as invalid. If the network itself fails we fall back to the
  /// offline prefix map rather than blocking someone from saving an account —
  /// the branch is left blank so nothing claims to be verified when it wasn't.
  Future<IfscInfo?> lookupIfsc(String ifsc) async {
    final code = ifsc.trim().toUpperCase();
    if (!RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$').hasMatch(code)) return null;

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 6);
    try {
      final req =
          await client.getUrl(Uri.parse('https://ifsc.razorpay.com/$code'));
      final res = await req.close().timeout(const Duration(seconds: 8));
      if (res.statusCode == 404) return null; // not a real IFSC
      if (res.statusCode == 200) {
        final body = await res.transform(utf8.decoder).join();
        final m = jsonDecode(body) as Map<String, dynamic>;
        final bank = (m['BANK'] as String?)?.trim() ?? '';
        if (bank.isNotEmpty) {
          return IfscInfo(
            bank: bank,
            branch: (m['BRANCH'] as String?)?.trim() ?? '',
            city: (m['CITY'] as String?)?.trim() ?? '',
          );
        }
      }
    } catch (_) {
      // Offline / timeout / malformed response — fall through.
    } finally {
      client.close(force: true);
    }

    final bank = _ifscBanks[code.substring(0, 4)];
    if (bank == null) return null;
    return IfscInfo(bank: bank, branch: '', city: '');
  }

  /// Rules cap `bankAccounts` at 5 entries; the client refuses earlier so the
  /// affiliate gets a sentence instead of a permission-denied.
  static const maxBankAccounts = 5;

  /// Shown when an account is pinned by a payout the admin is about to settle.
  static const bankLockedMessage =
      'A withdrawal to this account is still being processed. You can change it '
      'once that payout is settled.';

  /// The raw `bankAccounts` maps, mutable copies. Edits round-trip through the
  /// RAW maps rather than [BankAccount] because the model deliberately does not
  /// carry every stored field (`verifiedAt`, and anything the web adds later) —
  /// rebuilding the array from the model would silently drop them, and the two
  /// clients share this array.
  List<Map<String, dynamic>> _rawBanks(Map<String, dynamic>? data) =>
      ((data?['bankAccounts'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

  /// Persist a rewritten `bankAccounts` array. Mirrors [addBankAccount]'s write
  /// so both paths stay within the fields the rules allow.
  Future<void> _commitBanks(
      String uid, List<Map<String, dynamic>> banks) async {
    await _customer(uid).update({
      'bankAccounts': banks,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// The account id an unsettled payout is pointed at, or null when none is.
  ///
  /// Both halves matter: `hasPendingWithdrawal` is the flag the server flips
  /// while a request is open, and the request itself names the exact account.
  /// Only that one account is frozen — the affiliate can still manage the rest.
  static String? lockedBankIdFrom(
      AffiliateInfo? affiliate, List<WithdrawalRequest> withdrawals) {
    if (affiliate?.hasPendingWithdrawal != true) return null;
    for (final w in withdrawals) {
      if (w.isInFlight && w.bankAccountId.isNotEmpty) return w.bankAccountId;
    }
    return null;
  }

  /// Server-side re-check of [lockedBankIdFrom] at the moment of the write. The
  /// list screen already hides these actions, but a request can be raised on
  /// another device (or the web) while this screen is open, and redirecting the
  /// destination of money the admin is about to send must not be possible.
  Future<void> _assertBankNotLocked(String uid, String bankId) async {
    final snap = await _customer(uid).get();
    final aff = AffiliateInfo.fromCustomer(snap.data());
    if (aff?.hasPendingWithdrawal != true) return;
    final q = await _db
        .collection('withdrawalRequests')
        .where('customerId', isEqualTo: uid)
        .get();
    final locked =
        lockedBankIdFrom(aff, q.docs.map(WithdrawalRequest.fromDoc).toList());
    if (locked == bankId) throw StateError(bankLockedMessage);
  }

  /// Add a payout bank account to `customers/{uid}.bankAccounts` (direct write —
  /// rules allow this field, capped at 5). Only the masked last-4 is stored.
  /// The first account added becomes the default. Throws [StateError] on the cap.
  Future<void> addBankAccount(
    String uid, {
    required String accountHolderName,
    required String accountNumber,
    required String ifsc,
    required String bankName,
    String? branch,
  }) async {
    final ref = _customer(uid);
    final snap = await ref.get();
    final existing = BankAccount.listFrom(snap.data());
    if (existing.length >= maxBankAccounts) {
      throw StateError('You can save up to $maxBankAccounts bank accounts.');
    }
    final now = Timestamp.now(); // serverTimestamp is illegal inside array items
    final record = {
      'id': _db.collection('customers').doc().id,
      'accountHolderName': accountHolderName.trim(),
      'accountNumberMasked': maskAccountNumber(accountNumber),
      'ifsc': ifsc.trim().toUpperCase(),
      'bankName': bankName.trim(),
      'branch': (branch == null || branch.trim().isEmpty) ? null : branch.trim(),
      'isDefault': existing.isEmpty,
      'verifiedAt': null,
      'createdAt': now,
      'updatedAt': now,
    };
    await _commitBanks(uid, [..._rawBanks(snap.data()), record]);
  }

  /// "•••• 4821" — the only form of the account number that is ever stored,
  /// on both the add and the edit path so the two cannot drift.
  static String maskAccountNumber(String accountNumber) {
    final digits = accountNumber.trim();
    final last4 =
        digits.length >= 4 ? digits.substring(digits.length - 4) : digits;
    return '•••• $last4';
  }

  /// Edit a saved account in place.
  ///
  /// [accountNumber] is optional because only the mask is stored — there is no
  /// number to pre-fill on the form, so leaving it blank means "keep the number
  /// I already saved" and only the other details change. `id`, `createdAt`,
  /// `isDefault` and `verifiedAt` are carried over untouched: the shape written
  /// here has to stay identical to the web's.
  ///
  /// Throws [StateError] if the account vanished or is mid-payout.
  Future<void> updateBankAccount(
    String uid,
    String bankId, {
    required String accountHolderName,
    String? accountNumber,
    required String ifsc,
    required String bankName,
    String? branch,
  }) async {
    await _assertBankNotLocked(uid, bankId);
    final snap = await _customer(uid).get();
    final banks = _rawBanks(snap.data());
    final i = banks.indexWhere((b) => b['id'] == bankId);
    if (i < 0) throw StateError('That bank account no longer exists.');
    final current = banks[i];
    final hasNewNumber = accountNumber != null && accountNumber.trim().isNotEmpty;
    banks[i] = {
      ...current,
      'accountHolderName': accountHolderName.trim(),
      if (hasNewNumber)
        'accountNumberMasked': maskAccountNumber(accountNumber),
      'ifsc': ifsc.trim().toUpperCase(),
      'bankName': bankName.trim(),
      'branch': (branch == null || branch.trim().isEmpty) ? null : branch.trim(),
      'updatedAt': Timestamp.now(),
    };
    await _commitBanks(uid, banks);
  }

  /// Remove a saved account. If it was the default and others remain, the first
  /// survivor is promoted — a payout picker with no default would otherwise fall
  /// back to an arbitrary account. Throws [StateError] if it is mid-payout.
  Future<void> deleteBankAccount(String uid, String bankId) async {
    await _assertBankNotLocked(uid, bankId);
    final snap = await _customer(uid).get();
    final banks = _rawBanks(snap.data())..removeWhere((b) => b['id'] == bankId);
    if (banks.isNotEmpty && !banks.any((b) => b['isDefault'] == true)) {
      banks[0] = {
        ...banks[0],
        'isDefault': true,
        'updatedAt': Timestamp.now(),
      };
    }
    await _commitBanks(uid, banks);
  }

  /// Make [bankId] the one default, clearing every other. Not blocked while a
  /// payout is in flight: `requestWithdrawal` already snapshotted the account it
  /// will pay, so changing which one is pre-selected next time moves no money.
  Future<void> setDefaultBankAccount(String uid, String bankId) async {
    final snap = await _customer(uid).get();
    final banks = _rawBanks(snap.data());
    final now = Timestamp.now();
    for (var i = 0; i < banks.length; i++) {
      final shouldBeDefault = banks[i]['id'] == bankId;
      if ((banks[i]['isDefault'] == true) == shouldBeDefault) continue;
      // Only the rows that actually flip get a new updatedAt.
      banks[i] = {...banks[i], 'isDefault': shouldBeDefault, 'updatedAt': now};
    }
    await _commitBanks(uid, banks);
  }

  /// Request a payout to a saved bank account. Server-authoritative:
  /// validates affiliate-enabled, no concurrent withdrawal, amount ≤ confirmed
  /// balance and ≥ minimum, and that the bank belongs to the customer.
  /// Throws [FirebaseFunctionsException] with a user-facing message on failure.
  Future<String> requestWithdrawal({
    required int amountPaise,
    required String bankAccountId,
  }) async {
    final res = await _fn
        .httpsCallable('requestWithdrawal')
        .call<Map<String, dynamic>>({
      'amountPaise': amountPaise,
      'bankAccountId': bankAccountId,
    });
    return (res.data['shortId'] as String?) ??
        (res.data['withdrawalId'] as String?) ??
        '';
  }
}
