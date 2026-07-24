# Razorpay checkout — keep the SDK + its annotations, and the app's payment
# result callbacks, so release (minified) builds don't strip them.
-keepattributes *Annotation*
-dontwarn com.razorpay.**
-keep class com.razorpay.** { *; }
-optimizations !method/inlining/*
-keepclasseswithmembers class * {
  public void onPayment*(...);
}
