# MIGRATION INVENTORY — PriceScoutPT → Material Design 3

Date: 2026-08-09
Base: Expo SDK 54, RN 0.81.5, New Architecture ON, JS (no TypeScript), react-native-paper 5.12.5 already installed.
Scope: visual + motion layer only. No business logic, no data flow changes, no model changes.

## Screen / component tree

```
App.js                        — PaperProvider, BottomNavigation (4 tabs), splash loader
├── OnboardingScreen          — 6-slide tutorial (Avatar.Icon, Button, dots)
└── Tabs (BottomNavigation)
    ├── SearchScreen          — Searchbar, chip filters, FlatList, add-to-basket Dialog, SettingsModal, Snackbar
    │   └── ProductList       — FlatList of ProductCard (memoized)
    ├── FavoritesScreen       — FlatList of ProductCard + add-to-basket Dialog
    ├── CompareScreen         — SectionList per supermarket, summary Cards, disclaimer, share
    └── BasketScreen          — list chips, total Surface, FlatList rows, FAB "Limpar Cabaz", clear Dialog
Shared:
├── ProductCard.js            — Card + ProductImage, SUPERMARKET_BRANDS palette, formatPrice, getSupermarket
├── ProductHistoryModal.js    — full-screen Paper Modal: stats, LineChart, cross-market prices, favorite
└── SettingsModal.js          — sync, reset DB, clear favorites, about
```

## Current primitives

| File | LOC | Raw RN primitives | Paper components used |
|---|---|---|---|
| App.js | 187 | View, StatusBar | PaperProvider, BottomNavigation, ActivityIndicator, Text, Icon |
| SearchScreen | 690 | View, FlatList, ScrollView, Keyboard, SafeAreaView | Searchbar, Text, IconButton, Portal, Dialog, Button, TextInput, RadioButton, Surface, Chip, Icon, Snackbar |
| FavoritesScreen | 403 | View, FlatList, ScrollView, SafeAreaView | Text, IconButton, Surface, Portal, Dialog, Button, TextInput, RadioButton |
| BasketScreen | 550 | View, ScrollView, FlatList, Image, **Pressable** | Text, IconButton, Chip, FAB, Surface, Divider, ActivityIndicator, Portal, Dialog, Button |
| CompareScreen | 814 | View, ScrollView, SectionList, Share, Image, **Pressable** | Text, IconButton, Button, Chip, Surface, Divider, Badge, ActivityIndicator, Card |
| OnboardingScreen | 224 | View, Dimensions, SafeAreaView | Surface, Text, Button, Avatar, IconButton |
| ProductCard | 207 | View, Image | Card, Text, IconButton, Badge |
| ProductHistoryModal | 507 | View, ScrollView, Dimensions, SafeAreaView | Portal, Modal, Surface, Text, IconButton, Icon, Divider, Card, Badge, ActivityIndicator |
| SettingsModal | 364 | View, ScrollView, RNModal | Portal, Modal, Dialog, Surface, Text, IconButton, Divider, Button, ActivityIndicator, Snackbar |

## Hardcoded colors (to move into tokens)

- `ProductCard.js`: `#0050AA` (Lidl), `#2B8C3D` (Pingo Doce), `#003A70` (Aldi), `#E4002B` (Auchan) — brand-identity palette (functional, not theme); moves to `tokens.js` as `brandColors`. Continente uses `colors.danger`.
- `ProductHistoryModal.js`: `'#ffffff'` ×3 (chart background), `rgba(0,80,170,…)` (chart line), `rgba(100,100,100,…)` (chart labels) → theme tokens.
- `SettingsModal.js`: `rgba(0,0,0,0.5)` (blocking overlay) → `colors.scrim`.
- All other files reference `src/theme.js` `colors.*` — migration re-maps these to MD3 roles.

## Legacy Animated usage

- **None.** No `Animated.*` imports in any screen/component. Motion pass is greenfield.

## Loading patterns today

- Splash: ActivityIndicator + progress text (App.js).
- Basket resolve + Compare fuzzy-match: full-screen ActivityIndicator.
- History chart + cross-prices: inline small ActivityIndicator in placeholders.
- MD3 mapping: splash → determinate LinearProgressIndicator (>5s, known totals); Basket/Compare → skeleton rows matching the row layout; chart placeholders → skeleton blocks; cross-prices → shimmer rows.

## Navigation

- No navigation library today. Tabs = Paper BottomNavigation with manual `renderScene` switch.
- Product detail = full-screen Paper `Modal` (ProductHistoryModal), opened from 4 places.
- Target (user-approved): add `@react-navigation/native-stack`; tabs wrapped in a stack; ProductHistoryModal becomes a stack screen (same visual structure) enabling the shared-element hero on the product image.

## Dependency delta

- Add (expo-pinned): `react-native-reanimated` (4.x), `react-native-gesture-handler`, `@react-navigation/native`, `@react-navigation/native-stack`.
- Add (pure JS): `@material/material-color-utilities` (official MD3 palette generator = Material Theme Builder engine, seeded `#0050AA`).
- Icons: keep `@expo/vector-icons` via Paper `settings.icon` (no react-native-vector-icons native linking).
- Skipped vs template: `react-native-fast-shimmer` (native module; would regenerate android/; custom Reanimated shimmer instead), `react-native-vector-icons` (Expo-managed), `react-native-svg` (already present 15.12.1).
- Babel: SDK 54 + Reanimated 4 requires `react-native-worklets/plugin` (Reanimated 3's `react-native-reanimated/plugin` is deprecated in v4).
