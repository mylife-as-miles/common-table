# Design references and decisions

The user's two Bump image references are the principal visual input for this revision. Their useful qualities are recognizable places, expressive spatial markers, clear selection, social context on the map, and controls that act directly on the world.

## Sources inspected

- [Bump: how it works](https://help.bumpmaps.com/en/articles/11420926-how-bump-works), official product explanation. Its map connects people and places; we used spatial presence and selected-place continuity as reference ideas. Common Table does not implement Bump's location tracking, visit history, or live sharing.
- [Bump's official site](https://get.amo.co/en/bump), identifying the same amo product shown in the supplied images.
- [Findine Restaurant Mobile App UI/UX](https://www.behance.net/gallery/157289031/Findine-Restaurant-Mobile-App-UIUX), an accessible restaurant discovery reference connecting map, venue detail, and menus. No artwork or code was copied.
- [3D Map Illustration](https://www.behance.net/gallery/36045685/3D-Map-Illustration), Ian Browne. Search metadata was available, but the full project returned HTTP 403; it was not treated as a fully inspected visual source.
- [Mobbin's public iOS discovery page](https://mobbin.com/discover/apps/ios). The accessible page was sign-in limited; no claim is made to have reviewed gated app flows.
- [Proofline](https://github.com/mylife-as-miles/proofline), inspected read-only at commit `0681aee`, specifically its book/opening structure and styles. Its useful interaction idea is a physical object leaving a recognizable origin and returning there. We implemented our own shared photo/title transition and did not copy source, assets, or inherited third-party material. The reference checkout was left unchanged.

## Common Table's own world

The atlas is a crafted paper object in the same olive, cream, linen, and terracotta palette as the menu and dinner receipt. River, suspension bridge, park, piers, building relief, lighting, folds, and restaurant tokens are locally authored SVG/CSS. The geography is schematic; the dotted line connects a restaurant idea to the shared table, not a person's real position or a navigable route.

The Waiter is an original brass service bell with a bow tie, linen cloth, and a finite ring gesture. Its ring-bound service pad acts on the app's actual selected restaurant, ranking, shortlist, people, and plan. It never claims to be a connected language model. Requests outside its local service vocabulary get a clear fallback.

## Review and validation

An independent critic reviewed new screenshots afresh. Initial atlas scores were about 8.5 desktop and 7.8 mobile. Revisions added a recognizable bridge, stronger geography/lighting contrast, a compact mobile heading, readable disclosure, contextual service access, and an inline companion counter. Actual browser hit testing confirmed and then eliminated a bell/bookmark collision.

The final review judged the unified interactive demo at about 9/10, with no P1 design issue remaining. That is a subjective demo design judgment, not a production integration score. Small street labels and schematic geography remain opportunities for polish. See `artifacts/HANDOFF.md` and the machine-readable browser test report for verification and remaining integrations.

## Real OpenStreetMap interaction research

The follow-up research used Bump's official help and App Store presentation, Apple Maps' official feature page, Mapstr's public product pages, and Felt's interface/navigation guides. These are documented public behaviors and images, not claims of hands-on testing of those installed apps.

| Reference                                                                                                                                                                                 | Observed pattern                                                                                            | Common Table adaptation                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Bump: how it works](https://help.bumpmaps.com/en/articles/11420926-how-bump-works), [official App Store listing](https://apps.apple.com/us/app/bump-real-life-is-happening/id6471519217) | Search and map selection open contextual details around a meaningful place or person.                       | Real mapped places become tangible plate, cup and leaf objects; selected name/identity continues into field notes and The Waiter. No passive tracking, friend positions or visit history. |
| [Apple Maps](https://www.apple.com/maps/)                                                                                                                                                 | Detailed city geometry provides orientation; Place Cards disclose useful detail for a selected destination. | Warm geographic buildings and restrained water/park colors, an emphasized selected place, and a compact mobile place preview leading to the same paper notes. No invented business facts. |
| [Mapstr](https://en.mapstr.com/), [sorting places](https://en.mapstr.com/fonctionnalites/trier-mes-adresses-favorites)                                                                    | Categories and saved collections organize places on an interactive map.                                     | Food, coffee and outdoors use supplied map categories. Map objects, the visible-place index and session-only kept collection share selection. No implied dietary fit or visit claims.     |
| [Felt interface upgrades](https://felt.com/blog/ui-upgrades), [map navigation](https://help.felt.com/maps/navigate-the-map)                                                               | Reduced chrome gives the map more room; direct navigation includes keyboard controls.                       | An inline Unfold map mode, visible reset/zoom/orientation controls, native keyboard navigation and Escape/focus restoration.                                                              |

The authored supper atlas remains a separate, clearly marked fictional dining demo. Real map labels are sourced from loaded OSM/OpenFreeMap features and are not Qloo candidates. A real place never opens a fictional restaurant's menu. The explicitly chosen supper light is an atmospheric setting, not an environmental measurement. The previous weather integration was removed after the user's correction to OpenStreetMap.
