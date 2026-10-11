# =============================================================================
# build_diel_template.R - daily movement-rhythm template used by the calculator
# to RECOMMEND whether a file's timestamps are UTC or local time.
#
# Same idea as Elephant_metrics_shiny/timezone_examination (whole-file check):
#   1. steps of 0.25-4.5 h between consecutive fixes; speed at the step midpoint
#   2. time of day = local mean SOLAR time = UTC + longitude / 15
#   3. per file: harmonic regression of speed on solar hour (3 harmonics; 2 when
#      fixes are coarser than 2.5 h), standardised to mean 0 / SD 1
#   4. template = average of the standardised file curves (equal weight per file)
# The calculator fits the same curve to a partner's data read "as if UTC" and finds
# the shift that best matches the template: ~0 h -> UTC; ~ the local time-zone
# offset (e.g. +3 h in Kenya) -> local time.
#
# Validation printed at the end: each file is compared with a template built from
# the OTHER files (leave-one-out), as recorded (should be ~0 h) and with a +3 h
# local-clock shift injected (should be ~+3 h).
#
# HOW TO RUN (RStudio): open and click Source (reads every *_clean.csv; takes a
# few minutes). Writes diel_template.json next to this script.
# =============================================================================

here_dir  <- tryCatch(dirname(normalizePath(sys.frame(1)$ofile)), error = function(e) getwd())
clean_dir <- Sys.getenv("EMT_CLEAN_DIR", file.path(here_dir, "../../../Elephant_metrics_shiny/data/data_cleaned"))
out_json  <- file.path(here_dir, "diel_template.json")

suppressPackageStartupMessages({ library(data.table); library(jsonlite) })
GRID <- seq(0, 23.75, by = 0.25)

basis <- function(h, K) do.call(cbind, lapply(seq_len(K), function(k) cbind(cos(2 * pi * k * h / 24), sin(2 * pi * k * h / 24))))
# standardised harmonic diel curve on GRID; NULL if not estimable
diel_curve <- function(solar_h, speed, K) {
  ok <- is.finite(solar_h) & is.finite(speed)
  if (sum(ok) < 200 || length(unique(round(solar_h[ok]))) < 2 * K + 1) return(NULL)
  fit <- lm.fit(cbind(1, basis(solar_h[ok], K)), speed[ok])
  f <- drop(basis(GRID, K) %*% fit$coefficients[-1])
  if (!all(is.finite(f)) || sd(f) == 0) return(NULL)
  (f - mean(f)) / sd(f)
}
best_shift <- function(curve, template) {   # shift s (h) maximising cor(curve(h), template(h - s))
  shifts <- seq(-6, 6, by = 0.25)
  r <- sapply(shifts, function(s) cor(curve, template[((seq_along(GRID) - 1 - round(s / 0.25)) %% length(GRID)) + 1]))
  shifts[which.max(r)]
}

files <- list.files(clean_dir, pattern = "_clean\\.csv$", full.names = TRUE)
steps_of <- function(f) {
  d <- fread(f, select = c("name", "timestamp_corrected", "lon_wgs", "lat_wgs"), showProgress = FALSE)
  d[, t := as.numeric(as.POSIXct(timestamp_corrected, format = "%Y-%m-%dT%H:%M:%OSZ", tz = "UTC"))]
  d <- d[is.finite(t) & is.finite(lon_wgs) & is.finite(lat_wgs)]
  setorder(d, name, t)
  d[, `:=`(dt = shift(t, -1) - t, lon2 = shift(lon_wgs, -1), lat2 = shift(lat_wgs, -1)), by = name]
  d <- d[is.finite(dt) & dt >= 900 & dt <= 4.5 * 3600]
  rad <- pi / 180
  a <- sin((d$lat2 - d$lat_wgs) * rad / 2)^2 + cos(d$lat_wgs * rad) * cos(d$lat2 * rad) * sin((d$lon2 - d$lon_wgs) * rad / 2)^2
  d[, speed := 2 * 6371 * asin(pmin(1, sqrt(a))) / (dt / 3600)]
  d[, mid := t + dt / 2]
  d[, .(mid, lon = lon_wgs, speed, dt)]
}

curves <- list(); stepsets <- list()
for (f in files) {
  s <- tryCatch(steps_of(f), error = function(e) NULL)
  if (is.null(s) || !nrow(s)) next
  K <- if (median(s$dt) > 2.5 * 3600) 2 else 3
  solar <- ((s$mid / 3600) %% 24 + s$lon / 15) %% 24
  cv <- diel_curve(solar, s$speed, K)
  if (is.null(cv)) next
  nm <- sub("_clean\\.csv$", "", basename(f))
  curves[[nm]] <- cv; stepsets[[nm]] <- list(s = s, K = K)
  message(sprintf("  %-45s %8d steps", nm, nrow(s)))
}
template <- Reduce(`+`, curves) / length(curves)
template <- (template - mean(template)) / sd(template)

# leave-one-out validation: recorded clock and an injected +3 h local clock
val <- rbindlist(lapply(names(curves), function(nm) {
  tl <- Reduce(`+`, curves[names(curves) != nm]); tl <- (tl - mean(tl)) / sd(tl)
  s <- stepsets[[nm]]$s; K <- stepsets[[nm]]$K
  solar3 <- ((s$mid / 3600 + 3) %% 24 + s$lon / 15) %% 24
  data.table(file = nm, shift_recorded = best_shift(curves[[nm]], tl),
             shift_plus3 = best_shift(diel_curve(solar3, s$speed, K), tl))
}))
writeLines(toJSON(list(built = format(Sys.Date()), n_files = length(curves), step_h = 0.25, grid = round(template, 4)),
                  auto_unbox = TRUE), out_json)
message(sprintf("\nWrote %s from %d files", out_json, length(curves)))
message("Leave-one-out check (h): recorded clock should be ~0, injected +3 h should be ~3")
print(val[order(-abs(shift_recorded))], row.names = FALSE)
message(sprintf("recorded |shift| <= 1 h: %d of %d files; +3 h recovered within 1 h: %d of %d",
                sum(abs(val$shift_recorded) <= 1), nrow(val), sum(abs(val$shift_plus3 - 3) <= 1), nrow(val)))
