import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_typography.dart';
import '../../core/widgets/app_button.dart';
import '../../core/widgets/app_toast.dart';
import 'data/reviews_repository.dart';

/// The "own review" surface, shared by the two screens that show it: the order
/// detail screen (which is now the ONLY place a review can be written — you may
/// review a product once you have actually received it) and the read-only
/// ratings & reviews list (which badges the author's own pending review).

/// Opens the write-a-review sheet for [productId], bought on [orderId].
///
/// The caller doesn't have to do anything on success: the submitted review lands
/// in the customer's own-reviews stream, which is what drives the UI. Eligibility
/// is enforced by the security rules — a create is only allowed when
/// `customers/{uid}/purchases/{productId}` exists, which the server writes on
/// delivery — so a rejected write is surfaced with a specific message below.
Future<void> showWriteReviewSheet(
  BuildContext context, {
  required String productId,
  required String orderId,
  required String uid,
  required ReviewsRepository repo,
  String? productTitle,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.sheet)),
    ),
    builder: (_) => _WriteReviewSheet(
      productId: productId,
      orderId: orderId,
      uid: uid,
      repo: repo,
      productTitle: productTitle,
    ),
  );
}

class _WriteReviewSheet extends StatefulWidget {
  const _WriteReviewSheet({
    required this.productId,
    required this.orderId,
    required this.uid,
    required this.repo,
    this.productTitle,
  });
  final String productId;
  final String orderId;
  final String uid;
  final ReviewsRepository repo;
  final String? productTitle;

  @override
  State<_WriteReviewSheet> createState() => _WriteReviewSheetState();
}

class _WriteReviewSheetState extends State<_WriteReviewSheet> {
  int _rating = 0;
  final _title = TextEditingController();
  final _body = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (_rating < 1) {
      AppToast.show(context, 'Please pick a star rating.',
          variant: AppToastVariant.error);
      return;
    }
    if (_body.text.trim().length < 10) {
      AppToast.show(context, 'Please write at least a few words about the product.',
          variant: AppToastVariant.error);
      return;
    }
    setState(() => _busy = true);
    try {
      await widget.repo.submit(
        productId: widget.productId,
        orderId: widget.orderId,
        uid: widget.uid,
        rating: _rating,
        title: _title.text,
        body: _body.text,
      );
      if (!mounted) return;
      Navigator.of(context).pop();
      AppToast.show(context, 'Thanks! Your review is pending approval.',
          variant: AppToastVariant.success);
    } on FirebaseException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      // The rules reject a create when the delivery record is missing (or the
      // product was already reviewed off a different device). Say so plainly
      // instead of the generic retry message — retrying would fail identically.
      AppToast.show(
          context,
          e.code == 'permission-denied'
              ? "You can only review a product you've received. If this order was just delivered, try again in a moment."
              : "Couldn't submit your review. Please try again.",
          variant: AppToastVariant.error);
    } catch (_) {
      if (mounted) {
        setState(() => _busy = false);
        AppToast.show(context, "Couldn't submit your review. Please try again.",
            variant: AppToastVariant.error);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final subtitle = widget.productTitle?.trim();
    return Padding(
      padding: EdgeInsets.fromLTRB(
          AppSpacing.x20, AppSpacing.x20, AppSpacing.x20, bottomInset + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Write a review',
              style: AppType.headingLarge
                  .copyWith(fontSize: 18, fontWeight: FontWeight.w800)),
          // Which line item is being reviewed — an order can hold several.
          if (subtitle != null && subtitle.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    AppType.bodySmall.copyWith(color: AppColors.textSecondary)),
          ],
          const SizedBox(height: AppSpacing.x16),
          Row(
            children: [
              for (var n = 1; n <= 5; n++)
                GestureDetector(
                  onTap: () => setState(() => _rating = n),
                  behavior: HitTestBehavior.opaque,
                  child: Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Icon(
                      n <= _rating
                          ? Icons.star_rounded
                          : Icons.star_outline_rounded,
                      size: 34,
                      color: AppColors.brandAmber,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.x16),
          TextField(
            controller: _title,
            maxLength: 80,
            decoration: InputDecoration(
              hintText: 'Title (optional)',
              counterText: '',
              filled: true,
              fillColor: AppColors.surfaceChip,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadii.field),
                borderSide: BorderSide(color: AppColors.borderSubtle),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadii.field),
                borderSide: BorderSide(color: AppColors.borderSubtle),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadii.field),
                borderSide: const BorderSide(color: AppColors.brandGreen),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.x10),
          TextField(
            controller: _body,
            maxLength: 1000,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: 'What did you like or dislike about the product?',
              filled: true,
              fillColor: AppColors.surfaceChip,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadii.field),
                borderSide: BorderSide(color: AppColors.borderSubtle),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadii.field),
                borderSide: BorderSide(color: AppColors.borderSubtle),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadii.field),
                borderSide: const BorderSide(color: AppColors.brandGreen),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.x16),
          AppButton.reward(
            label: 'Submit review',
            loading: _busy,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }
}

/// Moderation status of the customer's OWN review (pending → approved/rejected).
/// Only ever shown to its author: everyone else sees approved reviews only.
class ReviewStatusChip extends StatelessWidget {
  const ReviewStatusChip({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, label) = switch (status) {
      'approved' => (
          AppColors.brandGreenSubtle,
          AppColors.brandGreen,
          'Published'
        ),
      'rejected' => (
          AppColors.statusErrorRed.withValues(alpha: 0.12),
          AppColors.statusErrorRed,
          'Not approved'
        ),
      _ => (AppColors.sky100, AppColors.sky700, 'Pending approval'),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(label,
          style: AppType.bodySmall.copyWith(
              fontSize: 11, fontWeight: FontWeight.w800, color: fg)),
    );
  }
}
