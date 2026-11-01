const ROOM = new URLSearchParams(location.search).get("room") || "ct1-collide";
const HOW_MANY = 3;
const SEND_EVERY = 50;
const BUBBLE_TIME = 3000;
const COOLDOWN = 1000;
const TRAIL_LENGTH = 25;
const FRICTION = 0.94;

let looks;
let mine = [];
let theirs = [];
let dummies = [];
let partnerId = null;
let selected;
let dragging = null;
let ui = {};
let p5lm;
let meetings = new Map();
let showHits = false;

async function makeLooks() {
  let star = await loadImage("assets/star.png");
  let blobSheet = await loadImage("assets/blob-sheet.png");

  return {
    // 1. Vector: drawn with p5 shapes
    circle: {
      r: 40,
      draw(o) {
        stroke(0);
        strokeWeight(3);
        if (o.hue < 0) fill(140);
        else {
          colorMode(HSB);
          fill(o.hue, 60, 90);
          colorMode(RGB);
        }
        circle(0, 0, 80);
      },
    },

    // 2. Image: a single PNG
    star: {
      r: 45,
      draw(o) {
        rotate(frameCount * 0.02);
        imageMode(CENTER);
        image(star, 0, 0);
        imageMode(CORNER);
      },
    },

    // 3. Sprite sheet: one row of 8 frames, each 100 x 100
    blob: {
      r: 38,
      draw(o) {
        let frames = 8, w = 100, h = 100;
        let f = floor(frameCount / 5) % frames;
        image(blobSheet, -w / 2, -h / 2, w, h, f * w, 0, w, h);
      },
    },
  };
}

function move(o) {
    if (o === dragging) {
        o.vx = mouseX + o.grabX - o.x;
        o.vy = mouseY + o.grabY - o.y;
    } else {
        o.vx *= FRICTION;
        o.vy *= FRICTION;
    }
    o.x += o.vx;
    o.y += o.vy;

    let r = looks[o.look].r;
    if (o.x < r || o.x > width - r) o.vx = -o.vx;
    if (o.y < r || o.y > height - r) o.vy = -o.vy;
    o.x = constrain(o.x, r, width - r);
    o.y = constrain(o.y, r, height - r);
    remember(o);
}

function remember(o) {
    o.history.push({x: o.x, y: o.y});
    if (o.history.length > TRAIL_LENGTH) o.history.shift();
}

function makeThing(x, y) {
    return {
        x, y, vx: 0, vy: 0,
        look: "circle", hue: 0,
        msg: "", mode: "push", force: 5, trail: false,
        history: [], bubbleUntil: 0,
    };
}

function drawThing(o) {
    let look = looks[o.look];

    if (o.trail) {
        for (let i = 0; i < o.history.length; i++) {
            drawingContext.globalAlpha = (i / o.history.length) * 0.4;
            drawLookAt(look, o, o.history[i]);
        }
        drawingContext.globalAlpha = 1;
    }
    drawLookAt(look, o, o);

    noStroke();
    fill(220);
    textAlign(CENTER, TOP);
    textSize(13);
    let owner = mine.includes(o) ? "you" : "them";
    text(owner + " . " + o.mode + " " + o.force, o.x, o.y + look.r + 8);

    if (o === selected){
        noFill();
        stroke(255);
        strokeWeight(2);
        drawingContext.setLineDash([6, 6]);
        circle(o.x, o.y, look.r * 2 + 16);
        drawingContext.setLineDash([]);
    }

    if (showHits) {
        noFill();
        stroke(255, 0, 0);
        strokeWeight(1);
        circle(o.x, o.y, look.r * 2);
    }
}

function drawLookAt(look, o, pos) {
    push();
    translate(pos.x, pos.y);
    look.draw(o);
    pop();
}

function mousePressed() {
    for (let i = mine.length - 1; i >= 0; i--) {
        let o = mine[i];
        if (dist(mouseX, mouseY, o.x, o.y) < looks[o.look].r) {
            dragging = o;
            o.grabX = o.x - mouseX;
            o.grabY = o.y - mouseY;
            pick(o);
            mine.push(mine.splice(i, 1)[0]);
            return;
        }
    }
}

function mouseReleased() {
    dragging = null;
}

function makeControls() {
    let bar = select("#controls");

    ui.which = createSpan("").parent(bar);
    ui.msg = createInput("").parent(bar);

    ui.mode = createSelect().parent(bar);
    ui.mode.option("push");
    ui.mode.option("pull");

    ui.force = createSlider(0, 10, 5, 1).parent(bar);
    ui.forceLabel = createSpan("").parent(bar);

    ui.look = createSelect().parent(bar);
    for (let name in looks) ui.look.option(name);

    ui.trail = createCheckbox(" trail", false).parent(bar);
}

function pick(o) {
    selected = o;
    ui.which.html("Object " + (o.id + 1) + ":");
    ui.msg.value(o.msg);
    ui.mode.selected(o.mode);
    ui.force.value(o.force);
    ui.look.selected(o.look);
    ui.trail.elt.querySelector("input").checked = o.trail;
}

function readControls() {
    let o = selected;
    o.msg = ui.msg.value();
    o.mode = ui.mode.value();
    o.force = Number(ui.force.value());
    o.look = ui.look.value();
    o.trail = ui.trail.checked();
    ui.forceLabel.html(o.mode + " with a force of " + o.force + " / 10");
}

function collides(a, b) {
    return dist(a.x, a.y, b.x, b.y) < looks[a.look].r + looks[b.look].r;
}

function keyPressed() {
    if (key === "h" && document.activeElement.tagName !== "INPUT") showHits = !showHits;
}

function checkEncounters() {
    for (let a of mine) {
        for (let b of theirs) {
            let key = a.id + "|" + b.id;
            let m = meetings.get(key) || { touching: false, next: 0 };
            let touching = collides(a, b);
            if (touching && !m.touching && millis() > m.next) {
                encounter(a, b);
                m.next = millis() + COOLDOWN;
            }
            m.touching = touching;
            meetings.set(key, m);
        }
    }
}

function encounter(a, b) {
    a.bubbleUntil = b.bubbleUntil = millis() + BUBBLE_TIME;
    knock(a, b);
    if (theirs === dummies) knock(b, a);
}

function knock(target, hitter) {
    if (target === dragging) return;
    let angle = atan2(target.y - hitter.y, target.x - hitter.x);
    let kick = hitter.force * 2.5;
    if (hitter.mode === "pull") kick = -kick;
    target.vx += cos(angle) * kick;
    target.vy += sin(angle) * kick;
}

function drawBubble(o) {
    if (!o.msg) return;
    textSize(16);
    let w = textWidth(o.msg) + 24;
    let x = constrain(o.x, w/2, width - w / 2);
    let y = o.y - looks[o.look].r - 34;

    fill(255);
    stroke(0);
    strokeWeight(2);
    rect(x - w / 2, y - 18, w, 36, 12);
    triangle(o.x - 8, y + 17, o.x + 8, y + 17, o.x, y + 28);
    noStroke();
    fill(0);
    textAlign(CENTER, CENTER);
    text(o.msg, x, y);
}

function connect() {
  // p5LiveMedia was written for p5 1.x and expects a sketch with an _elements list
  p5lm = new p5LiveMedia({ _elements: [] }, "DATA", null, ROOM);
  p5lm.on("data", gotData);
  p5lm.on("disconnect", lostPartner);
  setInterval(sendMine, SEND_EVERY);
  setStatus("Room “" + ROOM + "”: waiting for a partner (practise on the grey dummies)");
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function sendMine() {
    let list = mine.map(({ id, x, y, look, hue, msg, mode, force, trail }) => 
    ({ id, x, y, look, hue, msg, mode, force, trail }));
    p5lm.send(JSON.stringify(list));
}

function gotData(data, id) {
    if (partnerId === null) {
        partnerId = id;
        theirs = [];
        meetings.clear();
        setStatus("Room “" + ROOM + "“: connected");
    }
    if (id !== partnerId) return;

    let list = JSON.parse(data);
    theirs.length = list.length;
    list.forEach((d, i) => {
        if (!theirs[i]) theirs[i] = makeThing(d.x, d.y);
        if (!looks[d.look]) d.look = "circle";
        let {x, y, ...settings } = d;
        Object.assign(theirs[i], settings);
        theirs[i].tx = x;
        theirs[i].ty = y;
    });
}

function follow(o) {
    o.x = lerp(o.x, o.tx, 0.4);
    o.y = lerp(o.y, o.ty, 0.4);
    remember(o);
}

function lostPartner(id){
    if (id !== partnerId) return;
    partnerId = null;
    theirs = dummies;
    meetings.clear();
    setStatus("Room “" + ROOM + "“: partner left, waiting...");
}
async function setup(){
    createCanvas(960, 600);
    looks = await makeLooks();

    let lookNames = Object.keys(looks);
    makeControls();
    let hue = random(360);
    for (let i = 0; i < HOW_MANY; i++) {
        let o = makeThing(random(80, width - 80), random(80, height - 80));
        o.id = i;
        o.look = lookNames[i % lookNames.length];
        o.hue = (hue + i * 40) % 360;
        o.msg = "Hello from my " + o.look + "!";
        mine.push(o);
    }
    for (let i = 0; i < 2; i++) {
        let d = makeThing(width / 2, height / 3 + i * 200);
        d.id = "dummy" + i;
        d.msg = "Hello? Is there anyone here?";
        d.hue = -1; // grey
        dummies.push(d);
    }
    theirs = dummies;
    pick(mine[0]);
    connect();
}



function draw(){
    readControls();
    background(29, 29, 36);

    for (let o of mine) move(o);
    if (theirs === dummies) for (let o of dummies) move(o);
    else for (let o of theirs) follow(o);

    checkEncounters();
    for (let o of theirs) drawThing(o);
    for (let o of mine) drawThing(o);
    for (let o of [...theirs, ...mine]) if (millis() < o.bubbleUntil) drawBubble(o);
}



