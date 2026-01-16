# Todo
[ ] keyboard nav on comments dropdown etc., also outline cropped

# Done
[x] on keyboard nav:
* popup now gets hidden at bottom, when it reaches the end of list item in the feed
* when hitting escape when emoji menu is open, focus goes back to button, which is great! But this doesn't happen when hitting enter/space to select, please fix
* when lightbox is open and reactions menu is open, escape should close menu, but instead it closes photo
[x] rather than the selected reaction having a white border, very similar to the focus appearance, can you just change the background colour? e.g. like we do with theme dropdown
[x] when you tab out of the theme or group pickers, they close - this doesn't happen for reaction popup
[x] This wasn't fixed:
* when lightbox is open and reactions menu is open, escape should close menu, but instead it closes photo
[x] weird bug - changing reaction with comments open just clears comments, i.e. it says "No comments yet" even though there are some. Closing and reopening lightbox shows them again
[x] when hitting hide or show comments with keyboard nav, focus is lost from button, have to tab forward and then back to return. Can you retain focus?
[x] cache comments/reactions
[x] comments take up fixed height: I don't like it jumping up and down when scrolling between photos where some have few comments and others many
[x] deleting comment closes lightbox
[x] when deleting comments, confirmation needs to know it's own id to delete - seems like the first timeout or whatever deletes whatever is present, even if a new confirmation appeared. Is that confirmation even the best way to confirm? It also shifts the whole content down which is jarring.
[x] show/hide takes a while with no feedback. Can you expand or contract the UI optimisitally, and for showing then show a spinner for comments when expanding and populate comments when ready?
[x] allow sorting of comments by newest or oldest, default to newest (i.e. newest at top)
[x] when hovering (or holding on mobile) over the reaction pills, the names are quite small - can you make a liittle larger, and also add margin between pill and popup to make it easier to see when holding on mobile?
[x] make reactions appear above +
[x] scrolling improvements (scrolling left and right on comments also scrolls image, please fix/properly scroll pictures like gallery?):
