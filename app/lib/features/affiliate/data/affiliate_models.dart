import 'package:cloud_firestore/cloud_firestore.dart';

int _int(dynamic v) => (v as num?)?.toInt() ?? 0;
DateTime? _ts(dynamic v) => v is Timestamp ? v.toDate() : null;

/// The affiliate block on `customers/{uid}.affiliate`. Mirrors the web/admin
/// `AffiliateInfo` shape exactly. Balances are integer paise; [commissionRate]
/// is a FRACTION (0.05 = 5%). Allocated by admin (`adminAllocateAffiliate`) —
/// a customer is never an affiliate until then.
class AffiliateInfo {
  const AffiliateInfo({
    required this.enabled,
    required this.walletEnabled,
    required this.referralCode,
    required this.commissionRate,
    required this.pendingBalancePaise,
    required this.confirmedBalancePaise,
    required this.withdrawnBalancePaise,
    required this.lifetimeEarningsPaise,
    required this.referredCount,
    required this.hasPendingWithdrawal,
    required this.lastWithdrawalPaidAt,
  });

  final bool enabled;

  /// The admin's "Wallet access" toggle. `requestWithdrawal` rejects a payout
  /// with `failed-precondition` "Wallet access is disabled on your account."
  /// when this is false — read here so the client can say the same thing.
  final bool walletEnabled;
  final String referralCode;
  final double commissionRate; // fraction
  final int pendingBalancePaise;
  final int confirmedBalancePaise; // = withdrawable
  final int withdrawnBalancePaise;
  final int lifetimeEarningsPaise;
  final int referredCount;
  final bool hasPendingWithdrawal;

  /// Stamped by `approveWithdrawal` when a payout is settled.
  final DateTime? lastWithdrawalPaidAt;

  /// Whole-number percent for display (0.05 → 5). Tolerates a rate stored as a
  /// percent by mistake (>1), matching web `normaliseCommissionRate`.
  int get commissionPercent {
    final r = commissionRate > 1 ? commissionRate / 100 : commissionRate;
    return (r * 100).round();
  }

  static AffiliateInfo? fromCustomer(Map<String, dynamic>? data) {
    final a = data?['affiliate'];
    if (a is! Map) return null;
    final m = a.cast<String, dynamic>();
    if ((m['enabled'] as bool?) != true) return null;
    return AffiliateInfo(
      enabled: true,
      // Absent means "on" — the toggle post-dates the first affiliates, and the
      // server only blocks on an explicit `false` (see requestWithdrawal).
      walletEnabled: (m['walletEnabled'] as bool?) ?? true,
      referralCode: (m['referralCode'] as String?) ?? '',
      commissionRate: (m['commissionRate'] as num?)?.toDouble() ?? 0,
      pendingBalancePaise: _int(m['pendingBalancePaise']),
      confirmedBalancePaise: _int(m['confirmedBalancePaise']),
      withdrawnBalancePaise: _int(m['withdrawnBalancePaise']),
      lifetimeEarningsPaise: _int(m['lifetimeEarningsPaise']),
      referredCount: _int(m['referredCount']),
      hasPendingWithdrawal: (m['hasPendingWithdrawal'] as bool?) ?? false,
      lastWithdrawalPaidAt: _ts(m['lastWithdrawalPaidAt']),
    );
  }
}

/// A saved payout bank account — an element of `customers/{uid}.bankAccounts`.
/// Written directly by the client (rules allow it, max 5). Only the masked
/// last-4 of the account number is ever stored.
class BankAccount {
  const BankAccount({
    required this.id,
    required this.accountHolderName,
    required this.accountNumberMasked,
    required this.ifsc,
    required this.bankName,
    required this.branch,
    required this.isDefault,
    this.createdAt,
  });

  final String id;
  final String accountHolderName;
  final String accountNumberMasked; // "•••• 4321"
  final String ifsc;
  final String bankName;
  final String? branch;
  final bool isDefault;
  final DateTime? createdAt;

  /// Last 4 digits from the masked string, for the withdrawal snapshot.
  String get last4 {
    final digits = accountNumberMasked.replaceAll(RegExp(r'\D'), '');
    return digits.length >= 4 ? digits.substring(digits.length - 4) : digits;
  }

  /// e.g. "HDFC Bank •• 4821".
  String get label => '$bankName •• $last4';

  factory BankAccount.fromMap(Map<String, dynamic> m) => BankAccount(
        id: (m['id'] as String?) ?? '',
        accountHolderName: (m['accountHolderName'] as String?) ?? '',
        accountNumberMasked: (m['accountNumberMasked'] as String?) ?? '',
        ifsc: (m['ifsc'] as String?) ?? '',
        bankName: (m['bankName'] as String?) ?? '',
        branch: m['branch'] as String?,
        isDefault: (m['isDefault'] as bool?) ?? false,
        createdAt: _ts(m['createdAt']),
      );

  static List<BankAccount> listFrom(Map<String, dynamic>? data) {
    final raw = (data?['bankAccounts'] as List?) ?? const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(BankAccount.fromMap)
        .toList();
  }
}

/// One row in the affiliate commission ledger (`commissions/{id}`, read-own).
class Commission {
  const Commission({
    required this.id,
    required this.status,
    required this.commissionPaise,
    required this.orderShortId,
    required this.referredCustomerFirstName,
    required this.accruedAt,
  });

  final String id;

  /// 'pending' | 'confirmed' | 'paid' | 'cancelled'
  final String status;
  final int commissionPaise;
  final String orderShortId;
  final String referredCustomerFirstName;
  final DateTime? accruedAt;

  factory Commission.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    return Commission(
      id: doc.id,
      status: (d['status'] as String?) ?? 'pending',
      commissionPaise: _int(d['commissionPaise']),
      orderShortId: (d['orderShortId'] as String?) ?? '',
      referredCustomerFirstName:
          (d['referredCustomerFirstName'] as String?) ?? '',
      accruedAt: _ts(d['accruedAt']),
    );
  }
}

/// A payout request (`withdrawalRequests/{id}`, read-own). Written only by the
/// `requestWithdrawal` Cloud Function; approved/rejected by admin.
///
/// The redemption outcome is READ, never inferred: `approveWithdrawal` writes
/// the terminal record (`status: 'paid'` + [paidAt] + [paidAmountPaise], the NET
/// that actually reached the bank) and `rejectWithdrawal` writes the decline
/// ([rejectedAt] + [rejectionReason], with `paidAmountPaise` zeroed). Guessing
/// from `processedAt` — which BOTH set — cannot tell the two apart.
class WithdrawalRequest {
  const WithdrawalRequest({
    required this.id,
    required this.shortId,
    required this.status,
    required this.requestedAmountPaise,
    required this.paidAmountPaise,
    required this.bankAccountId,
    required this.bankName,
    required this.accountLast4,
    required this.rejectionReason,
    required this.paymentReference,
    required this.createdAt,
    required this.paidAt,
    required this.rejectedAt,
  });

  final String id;
  final String shortId;

  /// 'pending' | 'approved' | 'processing' | 'paid' | 'rejected' | 'cancelled'
  final String status;
  final int requestedAmountPaise;

  /// What actually reached the bank — the requested amount MINUS the processing
  /// fee. Only meaningful once [isPaid]; 0 on a rejected request.
  final int paidAmountPaise;

  /// The `bankAccounts[].id` this payout was pointed at. Snapshotted by
  /// `requestWithdrawal`, so it survives even if the account is later removed —
  /// which is exactly what lets the client tell whether a saved account is the
  /// one an in-flight payout depends on.
  final String bankAccountId;
  final String bankName;
  final String accountLast4;
  final String? rejectionReason;

  /// Admin-entered reference for the manual transfer (`payoutMode: 'manual'` —
  /// payouts are wired by hand, so there is no gateway id to show).
  final String? paymentReference;
  final DateTime? createdAt;
  final DateTime? paidAt;
  final DateTime? rejectedAt;

  bool get isPaid => status == 'paid';
  bool get isRejected => status == 'rejected';

  /// Still owed money: the admin has not settled or declined it yet. Anything
  /// that is not one of the three terminal states counts, so a status this
  /// client has never heard of is treated as in-flight rather than as safe.
  bool get isInFlight =>
      status != 'paid' && status != 'rejected' && status != 'cancelled';

  /// The amount to show for this row: the net actually paid once settled, the
  /// requested gross while it is still in flight or was declined. A paid request
  /// with no [paidAmountPaise] pre-dates the field being written, and quoting ₹0
  /// for money that demonstrably moved would be worse than quoting the gross.
  int get displayAmountPaise =>
      isPaid && paidAmountPaise > 0 ? paidAmountPaise : requestedAmountPaise;

  /// Terminal outcome in the customer's words. Null while the request is still
  /// pending/processing, which callers render with their own in-flight copy.
  String? get outcomeMessage {
    if (isPaid) return 'Amount credited to your bank account.';
    // Verbatim: the admin's reason is required server-side, so it is only ever
    // null on documents written before rejectWithdrawal enforced it.
    if (isRejected) {
      return rejectionReason?.trim().isNotEmpty == true
          ? rejectionReason!.trim()
          : 'Withdrawal declined.';
    }
    return null;
  }

  String get bankLabel => '$bankName •• $accountLast4';

  factory WithdrawalRequest.fromDoc(
      DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    final bank = (d['bankAccount'] as Map?)?.cast<String, dynamic>() ?? const {};
    return WithdrawalRequest(
      id: doc.id,
      shortId: (d['shortId'] as String?) ?? '',
      status: (d['status'] as String?) ?? 'pending',
      requestedAmountPaise: _int(d['requestedAmountPaise']),
      paidAmountPaise: _int(d['paidAmountPaise']),
      bankAccountId: (bank['id'] as String?) ?? '',
      bankName: (bank['bankName'] as String?) ?? '',
      accountLast4: (bank['accountNumberLast4'] as String?) ?? '',
      rejectionReason: d['rejectionReason'] as String?,
      paymentReference: d['paymentReference'] as String?,
      createdAt: _ts(d['createdAt']),
      paidAt: _ts(d['paidAt']),
      rejectedAt: _ts(d['rejectedAt']),
    );
  }
}
