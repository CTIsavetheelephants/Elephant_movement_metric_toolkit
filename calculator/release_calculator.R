# =============================================================================
# release_calculator.R - release a new version of the calculator from RStudio
# =============================================================================
# Use this AFTER you have changed the calculator (anything in calculator/src/,
# or release.config.json). It runs release.js (a small Node.js program in this
# folder) for you, which:
#   - gives the calculator its new version number (everywhere it is needed)
#   - builds the new calculator page:  docs/index.html
#   - writes the version note:         docs/version.json
#   - adds the release to CHANGELOG.md (in the repo's top folder)
#
# HOW TO USE
#   1. Fill in the three settings below.
#   2. Click Source (top right of this script's editor pane).
#   3. Push the changes to GitHub (e.g. in GitHub Desktop). GitHub Pages
#      publishes the new page within a few minutes.
#   Partners who open an older copy while online then see "A newer version is available".
#
# Version numbers have three parts, e.g. 1.2.3:
#   small fix or wording change     -> raise the last number   (1.1.0 -> 1.1.1)
#   new feature or changed display  -> raise the middle number (1.1.1 -> 1.2.0)
#   big change to how metrics work  -> raise the first number  (1.2.0 -> 2.0.0)
# The current version is shown at the bottom of the calculator page and in CHANGELOG.md.
# =============================================================================

new_version <- "1.1.1"                        # must be higher than the current version
whats_new   <- "Describe what changed here"   # one sentence; partners see this in the banner
required    <- FALSE                          # TRUE = older copies MUST update and cannot send
                                              # results until they do (use for wrong results)

# ---- nothing to change below -------------------------------------------------
calc_dir <- tryCatch(dirname(normalizePath(sys.frame(1)$ofile)), error = function(e) "")
if (!file.exists(file.path(calc_dir, "release.js")))
  calc_dir <- "C:/Users/angie/OneDrive/Documents/GitHub/STE/Elephant_movement_metric_toolkit/calculator"
node <- Sys.which("node")
if (!nzchar(node)) node <- "C:/Program Files/nodejs/node.exe"
if (!file.exists(node)) stop("Node.js was not found. Install it from https://nodejs.org (LTS version) and try again.")
if (whats_new == "Describe what changed here") stop("Please describe what changed in `whats_new` first.")

args <- c("release.js", new_version, shQuote(whats_new, type = "cmd"), if (isTRUE(required)) "--required")
old_wd <- setwd(calc_dir)
status <- system2(node, args)
setwd(old_wd)
if (!identical(status, 0L)) stop("The release did not finish - see the message above. Nothing has been published.")
