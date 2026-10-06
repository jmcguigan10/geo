# Meridian

A dark geography playground, built in this directory. The first game is **20 Missing Countries**: twenty random countries, territories, or autonomous regions disappear from a borderless map. Name them to restore them in green.

[Open Meridian](https://jmcguigan10.github.io/geo/) · [GitHub repository](https://github.com/jmcguigan10/geo)

## Run locally

Requires Node.js 24 or later. There are no npm dependencies to install.

```sh
npm run dev
```

Open **http://127.0.0.1:4173**. Use `node scripts/serve.js --port 8080` if that port is already in use. Serve the files through HTTP; opening `index.html` directly does not support the module and data requests reliably.

```sh
npm test
npm run build
npm run preview
```

The production output is `dist/`; preview runs on port 4174.

## Included

- 351 playable places: **197 countries, 52 separately administered or disputed territories, and 102 internal regions**. Abkhazia and South Ossetia are separate playable territories; Sark and Alderney have their own footprints too.
- Countries and territories by default, plus a countries-only pool.
- Ten-minute, classic 3½-minute, and untimed rounds.
- Answers accepted while typing or with Enter, common aliases, optional accents, and protection against ambiguous names.
- A whole country and an internal region cannot disappear together. Removing a country removes its internal regions; overseas dependencies remain separate answers.
- Drag, wheel, double-click, keyboard, and touch pinch navigation; up to **2,048×** zoom. Regional shortcuts, fullscreen play, and an atlas search help reach islands and microstates.
- A searchable atlas with geographic region, administrative category, parent country, and relevant boundary/status notes.
- Missing places have no outline, label, hover tooltip, or marker. Their geometry is absent, so their entire blank area has exactly the water color `#122e44`. Present land is `#67ad87`. Adjacent land polygons share one compound fill to avoid artificial border seams.

## Coverage and boundary limits

The 197-country pool contains 193 UN members, Palestine, Vatican City, Kosovo, and Taiwan. The broader pool adds dependencies, special territories, selected self-administered disputed places, and a documented set of internal regions with available boundaries. It includes Scotland, Wales, Northern Ireland, Kurdistan, Zanzibar, Spain's autonomous communities, Italy's special regions, China's five autonomous regions, and more.

**Internal autonomy coverage is broad, but not exhaustive at every administrative level.** Some lower-level autonomous districts and recently changed boundaries are not separately represented. Category names describe the game pool; they do not determine international recognition. Natural Earth's default boundary view and generalized coastlines are used; deep zoom does not add street-level geographic detail.

See [map sources and coverage](public/data/SOURCES.md), the [autonomy inventory and known gaps](public/data/AUTONOMY-SOURCES.md), and [machine-readable coverage](public/data/coverage.json). The in-page About dialog links these notes. Boundary data are public domain; exact pinned source versions and hashes are recorded with the generated data.

## Performance

Plain HTML, CSS, and native JavaScript modules; no framework, map SDK, external fonts, or runtime map service. Geography is projected and simplified ahead of time. The initial map is about 1.5 MB before compression; finer coastlines load only after zooming beyond 8×. Small island rings are retained at both resolutions. Rendering batches updates into animation frames, hides offscreen shapes, and avoids rebuilding geometry while panning within the same visible set.

Game, interaction, masking, mobile/fullscreen input, timer, alias, and lazy-map behavior are covered by Node's built-in test runner. A real browser performance and layout pass remains necessary: this execution environment blocked local listening sockets and browser launch, so automated DOM/interaction checks and standalone map renders were used here.

## GitHub Pages

The [Pages workflow](.github/workflows/pages.yml) tests, builds, and deploys `dist/` when `main` is pushed. Asset and data URLs are relative, so both account sites and repository sites work without a hard-coded base path.

1. Create a GitHub repository and push this directory to its `main` branch.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. Run the **Deploy to GitHub Pages** workflow, or push another commit to `main`.

See GitHub's [custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The repository is [jmcguigan10/geo](https://github.com/jmcguigan10/geo); its Pages URL is [jmcguigan10.github.io/geo/](https://jmcguigan10.github.io/geo/). After deployment is configured, pushes to `main` run the tests and publish the updated site.

## Map generation

The generated map assets are committed site inputs; a normal build does not download or regenerate them. To reproduce the geometry, use `scripts/build-map.py` with the pinned GeoJSON sources named in the source notes. The generator quantizes shared coordinates, dissolves internal seams, and simplifies shared chains consistently so countries and internal regions share edges at both resolutions.

To extend the atlas, update the generator's entity/region inventory and aliases, supply source-backed boundaries, regenerate the data, and run the tests and build. Internal regions use `parentId`; independent dependencies and disputed territories remain separate entries.
