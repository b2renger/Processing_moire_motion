// Moiré motion: a barrier-grid animation ("scanimation") from the frames in data/.
//
// Every frame is cut into vertical strips of stripWidth pixels and the strips are
// interleaved into one combined image. A black grid with one clear strip per
// period (stripWidth * number of frames) lies on top: sliding it one strip shows
// the next frame.
//
// Frames are read from data/ in file-name order (name them frame01, frame02...).
// Move the mouse to slide the grid. Keys:
//   SPACE        play / pause
//   LEFT, RIGHT  previous / next frame
//   G            show / hide the grid
//   S            save combined.png and grid.png in the sketch folder, to print
//
// The saved images have the window's size: raise it for print. For curved or
// radial grids and video import, use the web app in docs/.

int stripWidth = 4;

ArrayList<PImage> frames = new ArrayList<PImage>();
PImage combined, grid;
int period;
int offset = 0;
boolean playing = false;
boolean showGrid = true;

void settings() {
  size(1080, 1080);
}

void setup() {
  String[] names = new File(dataPath("")).list();
  if (names == null) names = new String[0];
  for (String name : sort(names)) {
    String n = name.toLowerCase();
    if (n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".gif") || n.endsWith(".tga")) {
      // on white, so transparent backgrounds print white
      PGraphics f = createGraphics(width, height);
      f.beginDraw();
      f.background(255);
      f.image(loadImage(name), 0, 0, width, height);
      f.endDraw();
      f.loadPixels();
      frames.add(f);
    }
  }
  if (frames.size() < 2) {
    println("Put at least two frames in the data folder.");
    exit();
    return;
  }
  int n = frames.size();
  period = stripWidth * n;

  // Strip k of every period comes from frame k.
  combined = createImage(width, height, RGB);
  combined.loadPixels();
  for (int x = 0; x < width; x++) {
    PImage f = frames.get((x / stripWidth) % n);
    for (int y = 0; y < height; y++) {
      combined.pixels[y * width + x] = f.pixels[y * width + x];
    }
  }
  combined.updatePixels();

  // Black, with a clear strip where frame 0 is. One period wider than the window
  // so it still covers everything while it slides.
  grid = createImage(width + period, height, ARGB);
  grid.loadPixels();
  for (int x = 0; x < grid.width; x++) {
    int c = (x / stripWidth) % n == 0 ? color(0, 0) : color(0);
    for (int y = 0; y < height; y++) {
      grid.pixels[y * grid.width + x] = c;
    }
  }
  grid.updatePixels();

  noCursor();
}

void draw() {
  if (playing && frameCount % 6 == 0) offset = (offset + stripWidth) % period;
  background(255);
  image(combined, 0, 0);
  // the grid moved right by `offset` pixels shows frame offset / stripWidth
  if (showGrid) image(grid, offset - period, 0);
}

void mouseMoved() {
  playing = false;
  offset = mouseX % period;   // one pixel of mouse = one pixel of grid, like the real thing
}

void keyPressed() {
  if (key == ' ') playing = !playing;
  if (key == 'g' || key == 'G') showGrid = !showGrid;
  if (keyCode == RIGHT) offset = (offset / stripWidth + 1) % frames.size() * stripWidth;
  if (keyCode == LEFT) offset = (offset / stripWidth + frames.size() - 1) % frames.size() * stripWidth;
  if (keyCode == LEFT || keyCode == RIGHT) playing = false;
  if (key == 's' || key == 'S') {
    combined.save(sketchPath("combined.png"));
    grid.save(sketchPath("grid.png"));
    println("Saved combined.png and grid.png in " + sketchPath());
  }
}
