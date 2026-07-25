import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/services/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/utils/money.dart';
import '../../core/widgets/app_circle_icon_button.dart';
import '../../core/widgets/app_shimmer.dart';
import '../../core/widgets/app_state_views.dart';
import 'data/review.dart';
import 'data/reviews_repository.dart';
import 'write_review_sheet.dart';

/// Screen — Ratings & reviews. READ-ONLY: lists approved reviews (+ the author's
/// own, any status, with a badge) for a product. Writing happens from a
/// DELIVERED order (order detail), because only a customer who received the
/// product may review it — the security rules enforce exactly that, so a write
/// button here would mostly just fail. Reads the shared `reviews` collection
/// (same as web + admin moderation).
class ReviewsScreen extends StatefulWidget {
  const ReviewsScreen({
    super.key,
    required this.productId,
    this.rating = 0,
    this.ratingCount = 0,
  });

  final String productId;
  final double rating;
  final int ratingCount;

  @override
  State<ReviewsScreen> createState() => _ReviewsScreenState();
}

class _ReviewsScreenState extends State<ReviewsScreen> {
  static final _repo = ReviewsRepository();
  static const _pageSize = 10;

  final _scroll = ScrollController();
  final _items = <Review>[]; // accumulated approved reviews (public)
  DocumentSnapshot<Map<String, dynamic>>? _cursor;
  bool _loading = false;
  bool _hasMore = true;
  bool _failed = false;
  bool _firstLoaded = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _loadMore();
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    // Load the next page a little before the user hits the very bottom so the
    // scroll stays smooth (mirrors product_list_screen).
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 600) {
      _loadMore();
    }
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final page =
          await _repo.approvedPage(widget.productId, startAfter: _cursor, pageSize: _pageSize);
      if (!mounted) return;
      setState(() {
        _items.addAll(page.reviews);
        _cursor = page.lastDoc ?? _cursor;
        _hasMore = page.hasMore;
        _loading = false;
        _firstLoaded = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = true;
        _firstLoaded = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final uid = context.watch<AuthProvider>().uid;
    return Scaffold(
      backgroundColor: AppColors.surfaceBackground,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context),
            Expanded(
              // Own reviews stay a live stream so a just-submitted (pending)
              // review shows immediately; the public approved list is paged.
              child: StreamBuilder<List<Review>>(
                stream: uid == null
                    ? const Stream.empty()
                    : _repo.watchMine(widget.productId, uid),
                builder: (context, mineSnap) {
                  // First page still loading and nothing to show yet → skeleton.
                  if (!_firstLoaded && _items.isEmpty) return const _Skeleton();
                  if (_failed && _items.isEmpty) {
                    return AppErrorState(
                      message: "Couldn't load reviews.",
                      onRetry: _loadMore,
                    );
                  }

                  final mine = mineSnap.data ?? const <Review>[];
                  final myIds = mine.map((r) => r.id).toSet();
                  final others =
                      _items.where((r) => !myIds.contains(r.id)).toList();

                  return ListView(
                    controller: _scroll,
                    padding: const EdgeInsets.fromLTRB(AppSpacing.x20,
                        AppSpacing.x4, AppSpacing.x20, AppSpacing.x24),
                    children: [
                      _summary(),
                      const SizedBox(height: AppSpacing.x20),
                      for (final r in mine) ...[
                        _ReviewCard(review: r, isMine: true),
                        const SizedBox(height: AppSpacing.x12),
                      ],
                      if (others.isEmpty && mine.isEmpty)
                        _empty()
                      else
                        for (final r in others) ...[
                          _ReviewCard(review: r, isMine: false),
                          const SizedBox(height: AppSpacing.x12),
                        ],
                      _footer(others.isNotEmpty),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Bottom affordance: a spinner while a page loads, a retry on failure, and a
  /// quiet end-marker once everything is loaded.
  Widget _footer(bool hasApproved) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: AppSpacing.x16),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2.4),
          ),
        ),
      );
    }
    if (_failed) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.x12),
        child: Center(
          child: TextButton(
            onPressed: _loadMore,
            child: Text("Couldn't load more · Retry",
                style: AppType.bodyMedium
                    .copyWith(fontWeight: FontWeight.w700, color: AppColors.brandGreen)),
          ),
        ),
      );
    }
    if (!_hasMore && hasApproved && _items.length > _pageSize) {
      return Padding(
        padding: const EdgeInsets.only(top: AppSpacing.x12),
        child: Center(
          child: Text('That’s all the reviews',
              style: AppType.bodySmall.copyWith(color: AppColors.textTertiary)),
        ),
      );
    }
    return const SizedBox.shrink();
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x8, AppSpacing.x20, AppSpacing.x12),
      child: Row(
        children: [
          AppCircleIconButton(
            icon: Icons.arrow_back_rounded,
            iconColor: AppColors.textPrimary,
            onTap: () => context.pop(),
          ),
          const SizedBox(width: AppSpacing.x14),
          Text('Ratings & reviews',
              style: AppType.headingLarge.copyWith(
                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
        ],
      ),
    );
  }

  Widget _summary() {
    if (widget.ratingCount == 0) return const SizedBox.shrink();
    return Row(
      children: [
        Text(widget.rating.toStringAsFixed(1),
            style: AppType.displayLarge.copyWith(
                fontSize: 40,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary)),
        const SizedBox(width: AppSpacing.x12),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                for (var i = 1; i <= 5; i++)
                  Icon(
                    i <= widget.rating.round()
                        ? Icons.star_rounded
                        : Icons.star_outline_rounded,
                    size: 16,
                    color: AppColors.brandAmber,
                  ),
              ],
            ),
            const SizedBox(height: 2),
            Text('${Money.count(widget.ratingCount)} ratings',
                style:
                    AppType.bodySmall.copyWith(color: AppColors.textSecondary)),
          ],
        ),
      ],
    );
  }

  Widget _empty() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.card),
        border: Border.all(color: AppColors.borderSubtle),
      ),
      child: Center(
        // No "be the first" nudge: reviews are written from a delivered order,
        // so there is nothing to act on from here.
        child: Text('No reviews yet.',
            textAlign: TextAlign.center,
            style: AppType.bodyMedium.copyWith(color: AppColors.textTertiary)),
      ),
    );
  }
}

class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review, required this.isMine});
  final Review review;
  final bool isMine;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.x16),
      decoration: BoxDecoration(
        color: isMine ? AppColors.brandGreenSubtle : Colors.white,
        borderRadius: BorderRadius.circular(AppRadii.card),
        border: Border.all(
            color: isMine
                ? AppColors.brandGreen.withValues(alpha: 0.25)
                : AppColors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(isMine ? 'You' : review.customerName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.bodyMedium.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary)),
              ),
              Row(
                children: [
                  for (var i = 1; i <= 5; i++)
                    Icon(
                      i <= review.rating.round()
                          ? Icons.star_rounded
                          : Icons.star_outline_rounded,
                      size: 14,
                      color: AppColors.brandAmber,
                    ),
                ],
              ),
            ],
          ),
          if (review.title != null) ...[
            const SizedBox(height: AppSpacing.x8),
            Text(review.title!,
                style: AppType.bodyMedium.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary)),
          ],
          if (review.body != null) ...[
            const SizedBox(height: 4),
            Text(review.body!,
                style: AppType.bodySmall.copyWith(
                    height: 1.5, color: AppColors.textSecondary)),
          ],
          if (isMine) ...[
            const SizedBox(height: AppSpacing.x12),
            ReviewStatusChip(status: review.status),
          ],
        ],
      ),
    );
  }
}

class _Skeleton extends StatelessWidget {
  const _Skeleton();
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x12, AppSpacing.x20, AppSpacing.x20),
      children: [
        const AppShimmer(height: 64, radius: AppRadii.card),
        const SizedBox(height: AppSpacing.x16),
        for (var i = 0; i < 3; i++) ...[
          const AppShimmer(height: 96, radius: AppRadii.card),
          const SizedBox(height: AppSpacing.x12),
        ],
      ],
    );
  }
}
