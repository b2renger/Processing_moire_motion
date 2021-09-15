


int W = 1080;
int H = 1080;
int numberOfFrames =7;
int pixelRatio = 1;

ArrayList <Layer> layers ;
PGraphics filter;

void settings() {
  size(W, H);
}

void setup() {

  layers = new ArrayList<Layer>();

  layers.add(new Layer("frame1.png", 0));
  layers.add(new Layer("frame2.png", 1));
  layers.add(new Layer("frame3.png", 2));
  layers.add(new Layer("frame4.png", 3));
  layers.add(new Layer("frame5.png", 4));
  layers.add(new Layer("frame6.png", 5));
  layers.add(new Layer("frame7.png", 6));


  filter = createGraphics(W, H);
  filter.beginDraw();
  for (int i = 0; i < filter.width; i+= pixelRatio) {
    filter.strokeWeight(pixelRatio);
    if (i%numberOfFrames == 0) {
      filter.stroke(255, 0);
    } else {
      filter.stroke(0);
    }
    filter.line(i, 0, i, filter.height);
  }
  filter.endDraw();

  background(255);
}


void draw() {
  background(255);
  
  imageMode(CENTER);
  for (int i = 0; i < layers.size(); i ++) {
    Layer l = layers.get(i);
    image(l.result, W*.5, H*.5);
  }

  float pos = map(mouseX, 0, W, -W*.5, W*.5);
  image(filter, pos, H*0.5,W,H);

}


class Layer {

  PImage src;

  PGraphics source;
  PGraphics filter;
  PGraphics result;



  Layer(String src, int idx) {
    this.src = loadImage(src);
    this.src.resize(W, H);

    result = createGraphics(W, H);
    source = createGraphics(W, H);
    filter = createGraphics(W, H);

    source.beginDraw();
    source.background(255);
    source.image(this.src, 0, 0, source.width, source.height);
    source.endDraw();


    filter.beginDraw();
    for (int i = 0; i < filter.width; i+= pixelRatio) {
      filter.strokeWeight(pixelRatio);
      if (i%numberOfFrames == idx) {
        filter.stroke(255);
      } else {
        filter.stroke(0);
      }
      filter.line(i, 0, i, filter.height);
    }
    filter.endDraw();

    do_blend();
  }

  void do_blend() {
    result.beginDraw();

    for (int i = 0; i <result.width; i++) {
      for (int j = 0; j <result.height; j++) {

        color cFilter = filter.get(i, j);
        color cSource = source.get(i, j);

        if (red(cFilter)> 0) {
          result.set(i, j, cSource);
        }
      }
    }

    result.endDraw();
  }
}
