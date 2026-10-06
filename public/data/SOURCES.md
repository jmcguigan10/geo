# Map data and coverage

The game currently contains **197 countries, 52 independently selectable dependencies or special/disputed territories, and 102 internal regions**. Another 29 uninhabited claims, research territories, military areas and tiny disputed features appear on the basemap but are excluded from random answers. The complete named inventory is in [coverage.json](coverage.json).

## Boundary data

The main boundary source is **Natural Earth 1:10m, version 5.1.1**, its map units, admin-1 subdivisions and disputed-area polygons, supplemented by its Sark and Alderney map-subunit polygons. Natural Earth explicitly distinguishes metropolitan areas from dependencies and overseas geographic units. All its vector data is public domain. Its boundaries are generalized cartographic geometry and its default boundary view follows de facto administration. They are not survey boundaries or a live statement of legal recognition.

- [Natural Earth map units documentation](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-details/)
- [Natural Earth countries and boundary-view explanation](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/)
- [Natural Earth public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/)
- [Pinned source repository](https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19)

Vatican City's very small stand-in polygon in this release was replaced with the [published geographic outline](https://gist.github.com/jaakla/ea9d93d542b5cff718163f84b07673c3) and Italy received the same matching hole. This correction is recorded in the generator and metadata. Other microstates retain the source's generalized cartographic footprints, including Monaco. The map does not replace islands or microstates with visible marker circles.

## Scope

The country category uses the 193 United Nations members plus Palestine, Vatican City, Kosovo and Taiwan. This is a game category, not a claim of universal diplomatic recognition. Greenland, the Faroe Islands, the Crown Dependencies, Hong Kong, Macau, Aruba, Curaçao, Sint Maarten, Cook Islands, Niue, Tokelau, Norfolk Island, Pitcairn and other separately mapped inhabited dependencies/special territories have their own answer entries. France's overseas geographic units are also separate.

Self-administered disputed areas include **Abkhazia and South Ossetia**, as explicitly requested, alongside Somaliland, Northern Cyprus, Western Sahara and Transnistria. Status notes are included in the metadata. Abkhazia and South Ossetia are removed from Georgia's playable footprint and do not have a parent answer relationship.

**Guernsey, Alderney and Sark** are distinct playable jurisdictions, using the [Guernsey Lieutenant-Governor's description of their separate self-government](https://www.governmenthouse.gg/). Guernsey's answer geometry includes Herm; Alderney and Sark have separate source footprints.

Internal regions include Scotland, Wales, Northern Ireland, Åland, Azores, Madeira, Spain's 17 communities and two autonomous cities, Italy's five special-statute regions, China's five autonomous regions, Russia's 21 republics and five other named autonomous subjects, Kurdistan, Zanzibar, Bougainville, Puntland, Adjara, Vojvodina, Barbuda, Belgium's three regions and Bosnia and Herzegovina's three separately mapped entities. Additional mapped regions include Karakalpakstan, Gorno-Badakhshan, Gagauzia, Nakhchivan, Nicaragua's two autonomous regions, three Panama comarcas, Aceh, Yogyakarta, the combined Papua special-autonomy area, Bangsamoro, Sabah, Sarawak, Mount Athos, Rodrigues, Príncipe, Azad Kashmir, Gilgit-Baltistan, Corsica, Canada's three territories and Australia's two mainland self-governing territories. Crimea is marked disputed.

The source-backed classification references and explicit gaps are recorded in [AUTONOMY-SOURCES.md](AUTONOMY-SOURCES.md). Autonomy has no single worldwide definition; ordinary provincial or state governments are not all separate answers. This release is a broad documented inventory, **not a claim that every autonomous unit at every administrative level is separately mapped**.

Known geometry limitations:

- **Bangsamoro:** older ARMM province geometry with Sulu excluded. It omits the current Special Geographic Area and does not separately carve Isabela City out of Basilan.
- **Papua:** the six modern Indonesian provinces are represented together by the combined special-autonomy area's older two-province footprint.
- **Panama:** three first-level comarcas are represented. Naso Tjër Di and the subprovincial Guna Madungandí/Guna Wargandí geometries are absent.
- India's tribal autonomous councils, Myanmar's six self-administered areas, China's lower-level autonomous prefectures/counties and some newer or subprovincial units require a deeper-level boundary source. They are not separately represented yet.
- Natural Earth's 2022-era administration snapshot can differ from later political changes. The Chagos/BIOT agreement is one specifically flagged example.

## Performance and reproduction

`world.json` has a 3600×1800 equirectangular coordinate system and compact SVG paths. It uses a coarse 0.025° tolerance while retaining every small source polygon. Its approximately 1.5 MB uncompressed payload compresses to approximately 0.6 MB. `world-detail.json` provides the finer 0.00125° geometry for zooming; the app can load it once after the player zooms in. Both resolutions use shared-chain simplification, preserve holes and use the SVG `nonzero` fill rule.

The generator dissolves shared subdivision edges, quantizes coordinates to 0.0001°, preserves tiny rings and writes the answer inventory. Reproduce the files with Python 3:

```sh
python3 scripts/build-map.py
```

The first run downloads three pinned GeoJSON inputs into `scripts/source-cache/`. Cached inputs can be provided with `--source-dir /path/to/cache`. Runtime assets are fully local; no third-party map tiles or map API requests are needed while playing.
