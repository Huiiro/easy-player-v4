# Easy Player Changelog

[简体中文](changelog.zh.md)

This document lists features, improvements, and fixes in descending version order.

## v3.3.0

- Added a plugin management page for on-demand installation, updates, enabling, disabling, and removal of official source and theme plugins, plus log filtering, export, and clearing. Startup does not download plugins automatically.
- Moved NetEase Cloud Music, Kugou, and QQ Music lyrics, artwork, and metadata, plus Bilibili and YouTube media search and downloads, into independent official plugins, with a public plugin SDK.
- Moved Black Hole, Rainy Night, Aurora, Ocean, Sunset, Forest, Matrix, Starfield, Star Trails, and DNA backgrounds into separately installable theme plugins. Added local third-party data and shader theme packages; official code backgrounds run in sandboxed frames.
- Added WebDAV, SMB, FTP, explicit and implicit FTPS, and SFTP remote file sources, and expanded Subsonic support. Unified connection and authentication settings, encrypted credential storage, SFTP host fingerprint verification, and remote song caching.
- Added source metadata search and preview with selective local file updates for tags, artwork, and lyrics. Added tag reload, revision checks to prevent stale edits, and restrictions on modifying files in playback.
- Expanded lyrics management with a timeline editor, original/translation/romanization processing, format conversion, import, export, and saving. Added per-song lyric offsets and batch flags for instrumental tracks and disabled network lyrics.
- Added Auto Mix with beat, key, and boundary-silence analysis for adaptive crossfades, including continuous transitions across PCM sample rates, channel layouts, and bit depths. An optional local stem runtime provides vocal protection and entry near the next vocal; without it, standard Auto Mix remains available.
- Added a compact player layout and refined artwork, lyrics, footer, and audio controls, including footer auto-hide and swipe interactions, narrow-window layouts, and page transitions.
- Expanded Windows window materials with Mica and Acrylic, and unified theme colors, background transitions, and custom theme resource rendering.
- Improved global and source search, album browsing, song sorting and columns, playlist headers, card motion, sidebar covers, and menu positioning.
- Added batch song preferences and clearing of less-recommended records, and refined recommendation feedback and genre separator handling.
- Fixed old tracks returning after queue clearing, navigation resets on queue refresh, and stale asynchronous track-switch updates. Improved window readiness, desktop lyrics stacking, downloaded audio finalization, and temporary file paths.

## v3.2.2

- Added custom themes with JSON and ZIP package import, switching, export, replacement by name, and deletion.
- Added resource manifests for assigning images, fonts, and text to supported regions, including playback thumb images and bundled font licenses.
- Added third-party theme risk notices and a 10-second import preview. Confirm to save, or cancel, press Esc, or let the timeout restore the previous theme. Later switches between installed themes and the default appearance take effect immediately.
- Custom themes replace the main background by default, with an option to retain the existing background. Fixed theme greetings overriding the user's custom home greeting.
- Unified shared control styles and exposed theme variables and public classes for sidebars, buttons, inputs, progress bars, dialogs, drawers, and menus.
- Fixed the primary color showing through transparent or translucent unplayed tracks, making the entire playback progress bar appear the same color.
- Added footer layouts with centered progress or a top progress line, adjustable maximum width and progress area proportions, responsive layouts, and overflow actions in the More menu.
- Added dedicated recommendation playlist pages. Click a playlist name on Home to view the full dated collection, with play-all, search, sorting, and song actions. Cover clicks retain playback controls.
- Regular and recommendation playlists independently remember whether their headers are collapsed or expanded across navigation and restarts.
- Added liked songs and recommendations to Home quick navigation, and matched listening-period and audio-quality icon hover effects to other overview cards.
- Added a song preference button before the player speed control. It cycles through neutral, liked, and disliked, shown as an outlined heart, filled heart, and thumbs-down icon. The larger thumbs-down icon keeps the button dimensions unchanged.
- Added statistics controls and data clearing. Disabling statistics stops recording and hides related statistics, history, and recommendations.
- Added a reset-to-defaults action for interface, player, shortcut, and other preferences while keeping library files and playback statistics.
- Added folder context menu actions to play songs and add them to a playlist.
- Expanded theme authoring documentation with variable defaults and scope, resource manifests, font guidance, and importable examples.

## v3.2.1

- Added configurable local and global shortcuts for seeking forward or backward by 5 seconds, liking songs, recommending songs less, and toggling desktop lyrics.
- Added Ctrl+E as the default shortcut to enable lightweight mode. Exiting lightweight mode remains a manual action.
- Fixed the lightweight mode shortcut when the saved mode did not match the actual window, and fixed interface settings not being saved to the database.
- Added single-song imports to the library, allowing users to select a local audio file.
- Renamed folder import actions to "Import folder".
- Added "Ignore songs shorter than 5 seconds", enabled by default. Folder and single-song imports both honor this setting and report the number of skipped files.
- Moved audio controls from the footer to the header.
- Added an automatically generated build number, available in Settings.
- Added an in-app changelog with offline access and Chinese or English content matching the interface language.
- Improved library search with pinyin, romanization, and relevance sorting, and refined mixed Chinese, English, and Japanese name ordering.

## v3.0.17

- Improved lyrics and desktop lyrics performance.
- Refined text and layout on the settings page.
- Added video background support.

## v3.0.13

- Corrected the position of macOS window controls.
- Improved the liquid background shader and fixed a black screen when opening it for the first time.
- Fixed liquid background reuse when a song has no cover art.
- Corrected song counts shown for parent folders.
- Added support for pressing Esc to leave the player page.

## v3.0.11

- Added a liquid background.

## v3.0.10

- Added support for following the system theme.
- Added the Windows Mica effect.
- Improved application performance and display.
- Fixed lyrics line wrapping and other known issues.

## v3.0.9

- Added macOS support.
- Fixed known issues.

## v3.0.8

- Improved player cover art, panels, and controls.
- Expanded lyrics format support and added romanized lyrics.
- Adjusted lyrics text spacing.

## v3.0.7

- Added customizable lyrics colors.
- Added the ability to add songs to playlists from the player.
- Fixed desktop lyrics layering and improved lyrics performance.
- Fixed playback history sorting.
- Refined interface colors and fixed other known issues.

## v3.0.6

- Improved application performance.
- Fixed display issues.

## v3.0.5

- Fixed application packaging.
- Corrected the stacking order of the scan progress window.
- Fixed lyrics source settings not being saved correctly.
- Fixed issues related to the item loading limit.

## v3.0.4

- Added the download center.
- Added support for copying song titles.
- Improved the interface, settings, and color styles.
- Fixed the selection component and issues preventing text selection.

## v3.0.3

- Added background styles.
- Fixed display issues and problems with the reduced motion setting.
- Refined card styles on the home and settings pages.
- Fixed footer animations.

## v3.0.2

- Fixed the color picker.
- Fixed player panel animations and control interactions.
- Fixed page display issues.

## v3.0.1

- Fixed application updates.
