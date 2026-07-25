import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import '../../core/widgets/app_toast.dart';
import 'data/wallet.dart';
import 'data/wallet_repository.dart';

/// Screen — Wallet (tab 4, Figma node 46:7390). Balance, a stored breakdown
/// (Rewards / Refunds / Cashback) and the live transaction ledger. Balance,
/// breakdown and ledger are read straight from `customers/{uid}`; the only
/// write path is **Add money**, a Razorpay-funded top-up run entirely through
/// the `topUpWallet`/`verifyTopUp` Cloud Functions (works in Razorpay TEST mode
/// with a `rzp_test_…` key returned by the function).
class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> with WidgetsBindingObserver {
  final _repo = WalletRepository();
  late final Razorpay _razorpay;
  bool _processing = false;
  // The pending top-up order awaiting the Razorpay result.
  TopUpOrder? _pending;

  // Resume reconciliation bookkeeping — mirrors the checkout payment screen:
  // the gateway activity can be killed while the app sits in the background,
  // in which case the plugin never delivers a success or error event and the
  // spinner would otherwise sit there forever.
  bool _checkoutOpen = false;
  bool _wentToBackground = false;
  bool _verifying = false;
  bool _reconciling = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _razorpay = Razorpay()
      ..on(Razorpay.EVENT_PAYMENT_SUCCESS, _onTopUpSuccess)
      ..on(Razorpay.EVENT_PAYMENT_ERROR, _onTopUpError)
      ..on(Razorpay.EVENT_EXTERNAL_WALLET, _onExternalWallet);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _razorpay.clear();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _wentToBackground = true;
      return;
    }
    if (state != AppLifecycleState.resumed) return;
    if (!_wentToBackground) return; // a brief 'inactive' blip, not a hand-off
    _wentToBackground = false;
    if (!_checkoutOpen || !_processing || _pending == null) return;
    unawaited(_reconcileAfterResume());
  }

  /// The customer came back with the Add-money spinner still running. Give the
  /// plugin a grace period to report in; if it stays silent (its activity was
  /// killed by the OS while backgrounded) ask the server what actually
  /// happened instead of leaving the spinner running forever.
  Future<void> _reconcileAfterResume() async {
    if (_reconciling) return;
    _reconciling = true;
    try {
      await Future<void>.delayed(const Duration(seconds: 4));
      final pending = _pending;
      if (!mounted || pending == null || !_processing || _verifying) return;
      final status = await _repo.fetchTopUpStatus(pending.razorpayOrderId);
      if (!mounted || !_processing || _verifying) return;
      _pending = null;
      setState(() => _processing = false);
      AppToast.show(
        context,
        status == 'captured'
            ? 'Money added to your wallet.'
            : "We couldn't confirm the top-up. If you were charged, it'll be resolved shortly.",
        variant: status == 'captured' ? AppToastVariant.success : AppToastVariant.error,
      );
    } catch (_) {
      if (mounted && _processing && !_verifying) {
        setState(() => _processing = false);
        AppToast.show(context,
            "Couldn't confirm the top-up. Please check back or try again.",
            variant: AppToastVariant.error);
      }
    } finally {
      _reconciling = false;
    }
  }

  /// Ask for an amount, open a Razorpay order, then hand off to the native
  /// checkout. The wallet is credited only after [verifyTopUp] succeeds; the
  /// balance/breakdown/ledger then refresh through their Firestore streams.
  Future<void> _startAddMoney() async {
    if (_processing) return;
    final uid = context.read<AuthProvider>().uid;
    final amountPaise = await _promptAmount();
    if (amountPaise == null || !mounted) return;
    setState(() => _processing = true);
    try {
      final order = await _repo.startTopUp(amountPaise);
      _pending = order;
      final prefill = await _prefill(uid);
      if (!mounted) return;
      _checkoutOpen = true;
      _razorpay.open({
        'key': order.keyId,
        'order_id': order.razorpayOrderId,
        'amount': order.amountPaise, // paise
        'currency': 'INR',
        'name': 'Barakath',
        'description': 'Wallet top-up',
        'prefill': prefill,
        'theme': {'color': '#0F7A5A'},
        'retry': {'enabled': false},
      });
    } on FirebaseFunctionsException catch (e) {
      _pending = null;
      if (mounted) {
        setState(() => _processing = false);
        AppToast.show(context, e.message ?? 'Could not start the top-up.',
            variant: AppToastVariant.error);
      }
    } catch (_) {
      _pending = null;
      if (mounted) {
        setState(() => _processing = false);
        AppToast.show(context,
            'Could not start the top-up. Please try again.',
            variant: AppToastVariant.error);
      }
    }
  }

  Future<int?> _promptAmount() => showModalBottomSheet<int>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.hero)),
        ),
        builder: (_) => const _AddMoneySheet(),
      );

  Future<void> _onTopUpSuccess(PaymentSuccessResponse r) async {
    _checkoutOpen = false;
    // Tell the resume reconciliation to stand down — a slow verify is not a
    // stranded spinner.
    _verifying = true;
    try {
      final credited = await _repo.verifyTopUp(
        razorpayOrderId: r.orderId ?? _pending?.razorpayOrderId ?? '',
        razorpayPaymentId: r.paymentId ?? '',
        razorpaySignature: r.signature ?? '',
      );
      if (!mounted) return;
      setState(() => _processing = false);
      AppToast.show(
        context,
        credited
            ? 'Money added to your wallet.'
            : "We couldn't verify the payment. If you were charged, it'll be "
                'resolved shortly.',
        variant: credited ? AppToastVariant.success : AppToastVariant.error,
      );
    } catch (_) {
      if (mounted) {
        setState(() => _processing = false);
        AppToast.show(context,
            'Top-up verification failed. Please contact support if charged.',
            variant: AppToastVariant.error);
      }
    } finally {
      _verifying = false;
      _pending = null;
    }
  }

  void _onTopUpError(PaymentFailureResponse r) {
    _checkoutOpen = false;
    _pending = null;
    if (!mounted) return;
    setState(() => _processing = false);
    final cancelled = r.code == Razorpay.PAYMENT_CANCELLED;
    AppToast.show(
        context,
        cancelled
            ? 'Top-up cancelled.'
            : (r.message?.isNotEmpty == true
                ? r.message!
                : 'Payment failed. Please try again.'),
        variant: AppToastVariant.error);
  }

  void _onExternalWallet(ExternalWalletResponse r) {
    // Payment continues in the external wallet app; the success/error event
    // arrives next and clears the spinner.
  }

  /// Best-effort prefill (name / email / phone) from the customer profile.
  Future<Map<String, dynamic>> _prefill(String? uid) async {
    try {
      if (uid == null) return const {};
      final d =
          (await FirebaseFirestore.instance.doc('customers/$uid').get()).data();
      return {
        'name': (d?['name'] as String?) ?? '',
        'email': (d?['email'] as String?) ?? '',
        'contact': (d?['phone'] as String?) ?? '',
      };
    } catch (_) {
      return const {};
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = context.select<AuthProvider, String?>((a) => a.uid);
    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
            child: Text('Wallet',
                style: AppType.headingLarge.copyWith(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.48)),
          ),
          Expanded(
            child: StreamBuilder<Wallet>(
              stream: uid == null ? null : _repo.watchWallet(uid),
              builder: (context, walletSnap) {
                if (walletSnap.hasError) {
                  return const AppErrorState(
                      message: "Couldn't load your wallet.");
                }
                final wallet = walletSnap.data;
                return ListView(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                      AppSpacing.x4, AppSpacing.x20, AppSpacing.x20),
                  children: [
                    if (wallet == null)
                      const AppShimmer(height: 132, radius: AppRadii.hero)
                    else
                      _BalanceCard(
                        balancePaise: wallet.balancePaise,
                        processing: _processing,
                        onAddMoney: _startAddMoney,
                      ),
                    const SizedBox(height: AppSpacing.x16),
                    if (wallet != null)
                      // Rewards/Cashback come from the ledger (summed by
                      // source); Refunds stays the customer-doc tally.
                      StreamBuilder<({int spinReward, int cashback})>(
                        stream: uid == null ? null : _repo.watchCreditTotals(uid),
                        builder: (context, totalsSnap) {
                          final totals = totalsSnap.data;
                          return _Breakdown(
                            rewardsPaise: totals?.spinReward ?? 0,
                            cashbackPaise: totals?.cashback ?? 0,
                            refundsPaise: wallet.refundsPaise,
                          );
                        },
                      ),
                    const SizedBox(height: AppSpacing.x16),
                    Text('Transactions',
                        style: AppType.bodyMedium.copyWith(
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary)),
                    const SizedBox(height: AppSpacing.x12),
                    if (uid != null) _Transactions(uid: uid, repo: _repo),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({
    required this.balancePaise,
    required this.processing,
    required this.onAddMoney,
  });
  final int balancePaise;
  final bool processing;
  final VoidCallback onAddMoney;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadii.hero),
      child: Container(
        width: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.brandGreen, AppColors.brandGreenDark],
          ),
        ),
        child: Stack(
          children: [
            Positioned(
              right: -40,
              top: -60,
              child: Container(
                width: 160,
                height: 160,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(80),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(22, 26, 22, 23),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text('NORMAL WALLET BALANCE',
                            style: AppType.labelUppercase.copyWith(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 0.48,
                                color: Colors.white.withValues(alpha: 0.85))),
                      ),
                      _AddMoneyPill(
                        onTap: processing ? null : onAddMoney,
                        processing: processing,
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(Money.fromPaise(balancePaise),
                      style: AppType.displayLarge.copyWith(
                          fontSize: 38,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.76,
                          color: Colors.white)),
                  const SizedBox(height: 3),
                  Text('Use at checkout on any order',
                      style: AppType.bodySmall.copyWith(
                          fontSize: 13,
                          color: Colors.white.withValues(alpha: 0.85))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddMoneyPill extends StatelessWidget {
  const _AddMoneyPill({required this.onTap, required this.processing});
  final VoidCallback? onTap;
  final bool processing;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 34,
        height: 34,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
        ),
        child: processing
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: AppColors.brandGreen),
              )
            : const Icon(Icons.add_rounded,
                size: 20, color: AppColors.brandGreen),
      ),
    );
  }
}

/// Bottom sheet — pick a top-up amount. Presets + free entry; min ₹100,
/// max ₹1,00,000 (mirrors the `topUpWallet` server bounds). Pops the chosen
/// amount in paise, or null on dismiss.
class _AddMoneySheet extends StatefulWidget {
  const _AddMoneySheet();

  @override
  State<_AddMoneySheet> createState() => _AddMoneySheetState();
}

class _AddMoneySheetState extends State<_AddMoneySheet> {
  static const _presets = [500, 1000, 2000, 5000]; // rupees
  final _controller = TextEditingController();
  int? _rupees;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _select(int rupees) {
    setState(() {
      _rupees = rupees;
      _controller.text = rupees.toString();
      _controller.selection =
          TextSelection.collapsed(offset: _controller.text.length);
    });
  }

  void _onChanged(String v) {
    final parsed = int.tryParse(v.trim());
    setState(() => _rupees = (parsed != null && parsed > 0) ? parsed : null);
  }

  @override
  Widget build(BuildContext context) {
    final rupees = _rupees ?? 0;
    final valid = rupees >= 100 && rupees <= 100000;
    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.x20,
        right: AppSpacing.x20,
        top: AppSpacing.x16,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.x20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                  color: AppColors.borderSubtle,
                  borderRadius: BorderRadius.circular(2)),
            ),
          ),
          const SizedBox(height: AppSpacing.x16),
          Text('Add money',
              style: AppType.headingLarge
                  .copyWith(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('Minimum ₹100. Credited to your wallet after payment.',
              style:
                  AppType.bodySmall.copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: AppSpacing.x16),
          TextField(
            controller: _controller,
            keyboardType: TextInputType.number,
            autofocus: true,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            onChanged: _onChanged,
            style: AppType.headingLarge
                .copyWith(fontSize: 22, fontWeight: FontWeight.w800),
            decoration: InputDecoration(
              prefixText: '₹ ',
              prefixStyle: AppType.headingLarge.copyWith(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary),
              hintText: '0',
              filled: true,
              fillColor: AppColors.bgMuted,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadii.field),
                borderSide: BorderSide.none,
              ),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            ),
          ),
          const SizedBox(height: AppSpacing.x12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [for (final p in _presets) _chip(p)],
          ),
          const SizedBox(height: AppSpacing.x20),
          AppButton.reward(
            label: valid
                ? 'Proceed to pay ${Money.fromPaise(rupees * 100)}'
                : 'Enter an amount',
            onPressed:
                valid ? () => Navigator.pop(context, rupees * 100) : null,
          ),
        ],
      ),
    );
  }

  Widget _chip(int rupees) {
    final selected = _rupees == rupees;
    return GestureDetector(
      onTap: () => _select(rupees),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? AppColors.brandGreenSubtle : Colors.white,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          border: Border.all(
              color: selected ? AppColors.brandGreen : AppColors.borderSubtle,
              width: selected ? 1.5 : 1),
        ),
        child: Text('₹$rupees',
            style: AppType.bodyMedium.copyWith(
                fontWeight: FontWeight.w700,
                color:
                    selected ? AppColors.brandGreen : AppColors.textPrimary)),
      ),
    );
  }
}

class _Breakdown extends StatelessWidget {
  const _Breakdown({
    required this.rewardsPaise,
    required this.refundsPaise,
    required this.cashbackPaise,
  });
  // Rewards (Spin Wheel) and Cashback (admin coupons) are summed from the
  // ledger by source; Refunds stays the customer-doc tally.
  final int rewardsPaise;
  final int refundsPaise;
  final int cashbackPaise;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _card(Icons.card_giftcard_rounded, AppColors.brandGoldStrong,
              rewardsPaise, 'Rewards'),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _card(Icons.arrow_downward_rounded, AppColors.success,
              refundsPaise, 'Refunds'),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _card(Icons.credit_card_rounded, AppColors.brandGoldStrong,
              cashbackPaise, 'Cashback'),
        ),
      ],
    );
  }

  Widget _card(IconData icon, Color iconColor, int paise, String label) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.field),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: iconColor),
          const SizedBox(height: 6),
          Text(Money.fromPaise(paise),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppType.bodyLarge.copyWith(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary)),
          const SizedBox(height: 6),
          Text(label,
              style: AppType.bodySmall
                  .copyWith(fontSize: 11, color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}

class _Transactions extends StatelessWidget {
  const _Transactions({required this.uid, required this.repo});
  final String uid;
  final WalletRepository repo;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<WalletTransaction>>(
      stream: repo.watchTransactions(uid),
      builder: (context, snap) {
        if (snap.hasError) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.x24),
            child: AppErrorState(
                message: "Couldn't load transactions.", compact: true),
          );
        }
        if (!snap.hasData) {
          return const Column(
            children: [
              _TxSkeleton(),
              SizedBox(height: AppSpacing.x12),
              _TxSkeleton(),
              SizedBox(height: AppSpacing.x12),
              _TxSkeleton(),
            ],
          );
        }
        final txs = snap.data!;
        if (txs.isEmpty) {
          return const Padding(
            padding: EdgeInsets.only(top: AppSpacing.x24),
            child: AppEmptyState(
              icon: Icons.account_balance_wallet_outlined,
              title: 'No transactions yet',
              subtitle: 'Wallet credits and spends will show up here.',
            ),
          );
        }
        return Column(
          children: [
            for (var i = 0; i < txs.length; i++) ...[
              _TxRow(tx: txs[i]),
              if (i < txs.length - 1) const SizedBox(height: AppSpacing.x12),
            ],
          ],
        );
      },
    );
  }
}

class _TxRow extends StatelessWidget {
  const _TxRow({required this.tx});
  final WalletTransaction tx;

  @override
  Widget build(BuildContext context) {
    final (icon, bg, iconColor) = tx.visual;
    final amount = '${tx.isCredit ? '+' : '−'}${Money.fromPaise(tx.amountPaise)}';
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
              color: bg, borderRadius: BorderRadius.circular(AppRadii.chipSmall)),
          child: Icon(icon, size: 19, color: iconColor),
        ),
        const SizedBox(width: AppSpacing.x12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(tx.displayTitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.bodyMedium.copyWith(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary)),
              const SizedBox(height: 1),
              Text(_relativeDate(tx.createdAt),
                  style: AppType.bodySmall
                      .copyWith(fontSize: 11, color: AppColors.textTertiary)),
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.x8),
        Text(amount,
            style: AppType.bodyMedium.copyWith(
                fontSize: 15,
                fontWeight: FontWeight.w800,
                color: tx.isCredit
                    ? AppColors.success
                    : AppColors.destructiveRed)),
      ],
    );
  }
}

class _TxSkeleton extends StatelessWidget {
  const _TxSkeleton();
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const AppShimmer(width: 40, height: 40, radius: AppRadii.chipSmall),
        const SizedBox(width: AppSpacing.x12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              AppShimmer(height: 12, radius: AppRadii.micro),
              SizedBox(height: 6),
              SizedBox(
                  width: 80,
                  child: AppShimmer(height: 10, radius: AppRadii.micro)),
            ],
          ),
        ),
      ],
    );
  }
}

/// "Today" / "Yesterday" / "N days ago" / "d MMM" from a ledger timestamp.
String _relativeDate(DateTime? d) {
  if (d == null) return '';
  final now = DateTime.now();
  final days = DateTime(now.year, now.month, now.day)
      .difference(DateTime(d.year, d.month, d.day))
      .inDays;
  if (days <= 0) return 'Today';
  if (days == 1) return 'Yesterday';
  if (days < 7) return '$days days ago';
  return DateFormat('d MMM').format(d);
}
