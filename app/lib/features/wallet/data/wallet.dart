import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

int _int(dynamic v) => (v as num?)?.toInt() ?? 0;

/// The customer's wallet snapshot (`customers/{uid}.wallet`). Balance + a stored
/// breakdown by source (rewards / refunds / cashback / top-ups). All CF-written;
/// the app only reads it.
class Wallet {
  const Wallet({
    required this.balancePaise,
    required this.rewardsPaise,
    required this.refundsPaise,
    required this.cashbackPaise,
    required this.topupPaise,
  });

  final int balancePaise;
  final int rewardsPaise;
  final int refundsPaise;
  final int cashbackPaise;
  final int topupPaise;

  static const empty = Wallet(
    balancePaise: 0,
    rewardsPaise: 0,
    refundsPaise: 0,
    cashbackPaise: 0,
    topupPaise: 0,
  );

  factory Wallet.fromCustomer(Map<String, dynamic>? data) {
    final w = (data?['wallet'] as Map?) ?? const {};
    final b = (w['breakdown'] as Map?) ?? const {};
    return Wallet(
      balancePaise: _int(w['balancePaise']),
      rewardsPaise: _int(b['rewardsPaise']),
      refundsPaise: _int(b['refundsPaise']),
      cashbackPaise: _int(b['cashbackPaise']),
      topupPaise: _int(b['topupPaise']),
    );
  }
}

/// One immutable wallet ledger entry (`customers/{uid}/walletTransactions`).
class WalletTransaction {
  const WalletTransaction({
    required this.id,
    required this.type,
    required this.source,
    required this.amountPaise,
    required this.title,
    required this.description,
    required this.orderShortId,
    required this.createdAt,
  });

  final String id;
  final String type; // credit | debit
  final String source; // refund | spin_reward | cashback | topup | ...
  final int amountPaise;
  final String title;
  final String? description;
  final String? orderShortId;
  final DateTime? createdAt;

  bool get isCredit => type == 'credit';

  /// Display title — falls back to a source-derived label if none was stored.
  String get displayTitle {
    if (title.isNotEmpty) return title;
    return switch (source) {
      'topup' => 'Added to wallet',
      'spin_reward' => 'Spin reward credited',
      'cashback' => 'Cashback',
      'refund' =>
        orderShortId != null ? 'Refund · $orderShortId' : 'Refund',
      'order_payment' =>
        orderShortId != null ? 'Used on order $orderShortId' : 'Used on order',
      'withdrawal' => 'Withdrawal',
      'admin_adjust' => 'Wallet adjustment',
      _ => 'Wallet transaction',
    };
  }

  /// Icon + tile tint + icon colour per source, matching the Figma rows.
  (IconData, Color, Color) get visual => switch (source) {
        'topup' => (
            Icons.add_rounded,
            AppColors.brandGreenSubtle,
            AppColors.brandGreen
          ),
        'spin_reward' => (
            Icons.card_giftcard_rounded,
            AppColors.brandGoldSubtle,
            AppColors.brandGoldStrong
          ),
        'cashback' => (
            Icons.credit_card_rounded,
            AppColors.brandGoldSubtle,
            AppColors.brandGoldStrong
          ),
        'order_payment' => (
            Icons.shopping_bag_outlined,
            AppColors.brandGreenSubtle,
            AppColors.brandGreen
          ),
        'refund' => (
            Icons.arrow_downward_rounded,
            const Color(0x1A16A34A), // success @ 10%
            AppColors.success
          ),
        'withdrawal' => (
            Icons.arrow_upward_rounded,
            AppColors.bgMuted,
            AppColors.textSecondary
          ),
        _ => (Icons.tune_rounded, AppColors.bgMuted, AppColors.textSecondary),
      };

  factory WalletTransaction.fromDoc(
      DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return WalletTransaction(
      id: doc.id,
      type: (d['type'] as String?) ?? 'credit',
      source: (d['source'] as String?) ?? '',
      amountPaise: _int(d['amountPaise']),
      title: (d['title'] as String?) ?? '',
      description: d['description'] as String?,
      orderShortId: d['orderShortId'] as String?,
      createdAt:
          d['createdAt'] is Timestamp ? (d['createdAt'] as Timestamp).toDate() : null,
    );
  }
}
