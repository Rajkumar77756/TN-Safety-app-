import 'package:flutter/material.dart';

class AppTheme {
  // Brand Colors matching the Next.js Dashboard
  static const Color backgroundBlack = Color(0xFF0A0A0A);
  static const Color cardBlack = Color(0xFF111111);
  static const Color accentRed = Color(0xFFFF4444);
  static const Color accentGreen = Color(0xFF00FF00);
  static const Color flagOrange = Color(0xFFF5A623);
  static const Color textWhite = Color(0xFFEDEDED);
  static const Color textGrey = Color(0xFF888888);
  static const Color borderDark = Color(0xFF333333);

  static final ThemeData darkTheme = ThemeData(
    brightness: Brightness.dark,
    primaryColor: accentRed,
    scaffoldBackgroundColor: backgroundBlack,
    fontFamily: 'Roboto', // Default Android sans-serif similar to Geist
    
    appBarTheme: const AppBarTheme(
      backgroundColor: cardBlack,
      elevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(
        color: textWhite,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        letterSpacing: 1,
      ),
      iconTheme: IconThemeData(color: textWhite),
    ),

    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: cardBlack,
      selectedItemColor: textWhite,
      unselectedItemColor: textGrey,
      showSelectedLabels: false,
      showUnselectedLabels: false,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
    ),

    cardTheme: CardTheme(
      color: cardBlack,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: borderDark, width: 1),
      ),
      elevation: 0,
    ),

    textTheme: const TextTheme(
      bodyLarge: TextStyle(color: textWhite, fontSize: 16),
      bodyMedium: TextStyle(color: textGrey, fontSize: 14),
      titleLarge: TextStyle(color: textWhite, fontSize: 20, fontWeight: FontWeight.bold),
    ),
  );
}
