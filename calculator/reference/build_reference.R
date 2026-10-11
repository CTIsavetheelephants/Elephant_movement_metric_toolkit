# =============================================================================
# build_reference.R - reference summaries for the calculator's
# "Compare with other populations" view.
#
# Reads STE's metrics_long.csv (individual-level) and writes ONLY pooled group
# summaries to reference_summaries.json. No study area names and no individual
# elephants leave this script.
#
# PRIVACY: the JSON is written OUTSIDE the public repo by default - next to
# metrics_long.csv (Elephant_metrics_shiny/data/metrics/reference_summaries.json).
# build.js only embeds it in the published page when "compareEnabled" is true in
# calculator/release.config.json, and "referencePath" there points to this file.
#
# Groups (forest/savannah from Elephant_metrics_shiny/analysis/study_area_species.csv,
# the same lookup the manuscript analyses use - edit there; East Africa = Kenya):
#   all       - every study area
#   forest    - species == "forest"
#   savannah  - species == "savannah"
#   east      - east_africa == TRUE (Kenya: STE's own data)
# Scales, each for All / Female / Male elephants:
#   global : one value per elephant (mean of its elephant-year means), then
#            mean, SE and percentiles (5 ... 95) across the group's elephants
#   year   : per elephant-year mean (monthly metrics averaged), then across elephants
#   month  : (monthly metrics) per elephant x calendar month across years, then
#            across elephants
# Site protection: a cell built from fewer than MIN_SITES study areas is dropped
# (except for groups listed in NO_MIN, i.e. STE's own East Africa data), so no single
# site's values can be read off a group summary.
#
# HOW TO RUN (RStudio): open this script and click Source. While comparisons are
# switched off nothing else is needed. Once they are on, release a new calculator
# version (calculator/release_calculator.R) so the page carries the new summaries.
# =============================================================================

here_dir    <- tryCatch(dirname(normalizePath(sys.frame(1)$ofile)), error = function(e) getwd())
metrics_csv <- Sys.getenv("EMT_REF_METRICS", file.path(here_dir, "../../../Elephant_metrics_shiny/data/metrics/metrics_long.csv"))
# forest / savannah come from the SAME lookup the manuscript analyses use
species_csv <- Sys.getenv("EMT_REF_SPECIES", file.path(here_dir, "../../../Elephant_metrics_shiny/analysis/study_area_species.csv"))
EAST_AFRICA_COUNTRIES <- c("Kenya")   # STE's own data
# written next to metrics_long.csv, OUTSIDE the public repo (see PRIVACY above)
out_json    <- Sys.getenv("EMT_REF_OUT", file.path(dirname(metrics_csv), "reference_summaries.json"))
MIN_SITES   <- 3
NO_MIN      <- c("east")

suppressPackageStartupMessages({ library(dplyr); library(jsonlite) })

d <- read.csv(metrics_csv, stringsAsFactors = FALSE, na.strings = c("", "NA")) %>%
  filter(is.finite(value), !is.na(Study_Area), !is.na(year)) %>%
  mutate(sex = case_when(tolower(Sex) == "female" ~ "Female", tolower(Sex) == "male" ~ "Male", TRUE ~ "Unknown"),
         ele = paste(Study_Area, Name, sep = "|"))

spp <- read.csv(species_csv, stringsAsFactors = FALSE)
grp <- data.frame(study_area = spp$Study_Area, species = tolower(trimws(spp$species)),
                  east_africa = spp$country %in% EAST_AFRICA_COUNTRIES, stringsAsFactors = FALSE)
missing <- setdiff(unique(d$Study_Area), grp$study_area)
if (length(missing)) {
  warning("Not in study_area_species.csv (treated as savannah, not East Africa) - add them there: ", paste(missing, collapse = "; "))
  grp <- rbind(grp, data.frame(study_area = missing, species = "savannah", east_africa = FALSE))
}
GROUPS <- list(
  all      = list(label = "All study areas",       sites = unique(d$Study_Area)),
  forest   = list(label = "Forest elephants",      sites = grp$study_area[grp$species == "forest"]),
  savannah = list(label = "Savannah elephants",    sites = grp$study_area[grp$species == "savannah"]),
  east     = list(label = "East Africa (Kenya, STE data)", sites = grp$study_area[grp$east_africa])
)
SEX <- c("All", "Female", "Male")
PROBS <- seq(0.05, 0.95, by = 0.05)

# one value per elephant per period -> summary rows for one group
summ <- function(ind, gid, with_q = FALSE) {
  if (!nrow(ind)) return(NULL)
  ind_all <- mutate(ind, sex = "All")
  x <- bind_rows(ind_all, filter(ind, sex %in% c("Female", "Male"))) %>%
    group_by(sex, period) %>%
    summarise(n = n(), n_sites = n_distinct(Study_Area), m = mean(v),
              se = if (n() > 1) sd(v) / sqrt(n()) else NA_real_,
              q = list(if (with_q) unname(quantile(v, PROBS, type = 7)) else NULL), .groups = "drop")
  if (!gid %in% NO_MIN) x <- filter(x, n_sites >= MIN_SITES)
  x
}
pack <- function(rows) {
  if (is.null(rows) || !nrow(rows)) return(NULL)
  rows <- arrange(rows, g, sex, period)
  out <- list(g = rows$g, x = match(rows$sex, SEX) - 1L, p = rows$period, n = rows$n, ns = rows$n_sites,
              m = signif(rows$m, 4), se = signif(rows$se, 3))
  if (any(lengths(rows$q))) out$q <- lapply(rows$q, function(q) signif(q, 4))
  out
}

out <- list()
for (met in sort(unique(d$metric))) {
  dm <- d[d$metric == met, ]
  monthly <- all(dm$granularity == "month")
  res <- list(global = NULL, year = NULL, month = NULL)
  for (gid in names(GROUPS)) {
    dg <- dm[dm$Study_Area %in% GROUPS[[gid]]$sites, ]
    if (!nrow(dg)) next
    if (met == "male_female_ba_overlap_year") {
      # population-level metric: one value per study area-year; sites play the role of elephants
      sy <- dg %>% distinct(Study_Area, year, value) %>% transmute(Study_Area, sex = "All", period = year, v = value)
      y <- summ(sy, gid); g <- summ(sy %>% group_by(Study_Area, sex) %>% summarise(v = mean(v), .groups = "drop") %>% mutate(period = 0L), gid, TRUE)
      y <- filter(y, sex == "All"); g <- filter(g, sex == "All")
    } else {
      ey <- dg %>% group_by(Study_Area, ele, sex, year) %>% summarise(v = mean(value), .groups = "drop")
      y <- summ(transmute(ey, Study_Area, sex, period = year, v), gid)
      g <- summ(ey %>% group_by(Study_Area, ele, sex) %>% summarise(v = mean(v), .groups = "drop") %>% mutate(period = 0L), gid, TRUE)
      if (monthly) {
        mo <- dg %>% filter(!is.na(month)) %>% group_by(Study_Area, ele, sex, period = month) %>% summarise(v = mean(value), .groups = "drop")
        res$month <- bind_rows(res$month, mutate(summ(mo, gid), g = gid))
      }
    }
    res$year   <- bind_rows(res$year, if (!is.null(y)) mutate(y, g = gid))
    res$global <- bind_rows(res$global, if (!is.null(g)) mutate(g, g = gid))
  }
  out[[met]] <- Filter(Negate(is.null), lapply(res, pack))
}

ref <- list(
  meta = list(built = format(Sys.Date()), source = basename(metrics_csv),
              source_modified = format(file.mtime(metrics_csv), "%Y-%m-%d"),
              n_study_areas = length(unique(d$Study_Area)), n_elephants = length(unique(d$ele)),
              min_sites = MIN_SITES, probs = PROBS),
  sexes = SEX,
  groups = lapply(names(GROUPS), function(gid) {
    s <- intersect(GROUPS[[gid]]$sites, d$Study_Area)
    list(id = gid, label = GROUPS[[gid]]$label, n_sites = length(s),
         n_elephants = length(unique(d$ele[d$Study_Area %in% s])))
  }),
  metrics = out
)
writeLines(toJSON(ref, auto_unbox = TRUE, na = "null", digits = NA, null = "null"), out_json)
message(sprintf("Wrote %s: %d groups, %d metrics, %.2f MB (no study area names)", out_json, length(GROUPS), length(out), file.size(out_json) / 1e6))
for (g in ref$groups) message(sprintf("  %-32s %2d study areas, %4d elephants", g$label, g$n_sites, g$n_elephants))
