# Menu paper renderer

`st-page-flip.js` is StPageFlip **2.0.7**'s ESM build from the MIT-licensed
[upstream project](https://github.com/Nodlik/StPageFlip). Its full MIT notice is
included at the top of the artifact. No reference app content or styles are used.

The sole engine patch replaces `Render.start()`'s unbounded animation loop with
an initial geometry update and exposes its original renderer as
`renderFrame(time)`. `PaperCurl` drives it only after pointer movement and during
a finite release/arrow animation. Disposal cancels that frame and removes the
engine's input/resize listeners. The page geometry and shadow solver are unchanged.

The adapter uses the pinned engine's completion solver to settle a held fold
from its exact current position. A forward/back drag must exceed both 36 pixels
and 28% of a leaf's width in its intended direction. Short drags return; Escape,
pointer cancellation, resize, close, navigation and power-mode changes cancel.
Domain callbacks fire once after completion. Touch gestures start only on the
two corner buttons; ordinary paper scrolling and controls stay native.

During a fold, inert paint copies contain the previous/current/next actual venue
data. Resting pages are temporarily inert and restored before the next action.
The renderer is never mounted for reduced motion or low-power mode. The npm
`page-flip` package is not a runtime dependency of these modules.
