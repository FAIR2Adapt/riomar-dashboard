# RiOMar Dashboard

<!-- QUALITY_BADGE_START -->
[![Software quality](https://img.shields.io/badge/FAIRness-52%25-orange "score: 52% | passed: 21 | failed: 19 | errors: 1")](RSFC_REPORT.md)
<!-- QUALITY_BADGE_END -->

WebGL-based interactive globe viewer for FAIR Digital Objects, built on [GridLook](https://github.com/observingClouds/gridlook). Part of the [FAIR2Adapt](https://fair2adapt-eosc.eu) project.

Supports HEALPix DGGS (including multiscale pyramids), curvilinear, regular, triangular, Gaussian reduced, and irregular grids from cloud-hosted Zarr datasets.

![](docs/assets/showcase.webp)

## Features

- **Multiple grid types**: HEALPix, curvilinear, regular, triangular, Gaussian reduced, irregular
- **Token authentication**: access private datasets via `::token=` URL parameter
- **RO-Crate resolution**: paste an RO-Crate PID to auto-discover and load the dataset
- **Interactive controls**: colormaps, bounds, projections, time/dimension slicing
- **MapLibre basemaps**: OSM, EMODNET bathymetry, satellite

## Try It Live

**Dashboard**: https://fair2adapt.github.io/riomar-dashboard/

**With FDO2map**: https://fair2adapt.github.io/FDO2map/ — paste an RO-Crate PID to resolve and visualize

### Example datasets

```
# RiOMAR ocean model (HEALPix)
https://fair2adapt.github.io/riomar-dashboard/#https://pangeo-eosc-minioapi.vm.fedcloud.eu/afouilloux-riomar/small_hp_pyramid.zarr

# Sentinel-2 reflectance (HEALPix multiscale pyramid)
https://fair2adapt.github.io/riomar-dashboard/#https://pangeo-eosc-minioapi.vm.fedcloud.eu/afouilloux-dggs/sentinel_bbox_l20_pyramid.zarr

# Private dataset with API key
https://fair2adapt.github.io/riomar-dashboard/#https://fair2adapt.duckdns.org/bucket/dataset.zarr::token=YOUR_API_KEY
```

## URL format

```
https://fair2adapt.github.io/riomar-dashboard/#<ZARR_URL>::param1=value1::param2=value2
```

| Parameter | Description |
|-----------|-------------|
| `token` | API key for authenticated proxy |
| `varname` | Variable to display |
| `colormap` | Colormap name |
| `boundlow` / `boundhigh` | Color scale bounds |

## Development

Requires [Node.js](https://nodejs.org/) (v18+).

```bash
npm install
npm run dev        # Dev server on localhost:5173
npm run build      # Production build
npm run typecheck  # Type checking
npm run lint       # Linting
```

## Deployment

The dashboard is deployed as a static site on GitHub Pages via the `deploy.yml` workflow.

To deploy elsewhere, run `npm run build` and serve the `dist/` directory.

## Acknowledgements

Based on [GridLook](https://github.com/observingClouds/gridlook) by Tobias Kölling and contributors. Extended with RO-Crate resolution, token authentication, and MapLibre basemaps for the FAIR2Adapt project.

## License

[MIT](LICENSE)