/**
 * Ledger Light — SQL Query Runner
 * Seeded relational dataset. A small e-commerce analytics warehouse:
 * customers, products, orders, order_items, reviews.
 *
 * Generation is deterministic (fixed seed PRNG) so every visitor sees
 * the same data, and large tables (orders ~50k rows) exercise the
 * pagination path of the result renderer.
 */

// ---- Tiny deterministic PRNG (mulberry32) -----------------------------------

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260812);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

const CITIES: [string, string][] = [
  ["Bangalore", "India"],
  ["Chennai", "India"],
  ["Mumbai", "India"],
  ["Delhi", "India"],
  ["Hyderabad", "India"],
  ["Pune", "India"],
  ["Kolkata", "India"],
  ["Austin", "USA"],
  ["Berlin", "Germany"],
  ["London", "UK"],
  ["Singapore", "Singapore"],
  ["Toronto", "Canada"],
];

const SEGMENTS = ["B2C", "B2B", "VIP"];
const segmentWeights = [0.55, 0.35, 0.1];

function weightedSegment(): string {
  const r = rand();
  if (r < segmentWeights[0]) return "B2C";
  if (r < segmentWeights[0] + segmentWeights[1]) return "B2B";
  return "VIP";
}

const FIRST = [
  "Aarav", "Ishita", "Rohan", "Meera", "Karthik", "Priya", "Aditya", "Nisha",
  "Vikram", "Ananya", "Daniel", "Sarah", "Lukas", "Emma", "Wei", "Priyanka",
  "Suresh", "Lakshmi", "James", "Fatima",
];
const LAST = [
  "Sharma", "Iyer", "Nair", "Reddy", "Patel", "Mukherjee", "Chen", "Mueller",
  "Smith", "Gupta", "Rao", "Kumar", "Fischer", "Brown", "Singh", "Verma",
];

function customerName(i: number): string {
  void i;
  return `${pick(FIRST)} ${pick(LAST)}`;
}

const CATEGORIES = [
  "Audio",
  "Home",
  "Kitchen",
  "Wearables",
  "Computing",
  "Lighting",
];
const PRODUCT_ROOTS: Record<string, string[]> = {
  Audio: ["Wireless Earbuds", "Studio Headphones", "Bluetooth Speaker", "USB Mic", "Soundbar", "Ear Hook Speaker"],
  Home: ["Air Purifier", "Desk Fan", "Smart Bulb", "Humidifier", "Heater", "Thermostat"],
  Kitchen: ["Espresso Maker", "Blender", "Air Fryer", "Kettle", "Toaster", "Juicer"],
  Wearables: ["Fitness Band", "Smart Watch", "GPS Tracker", "Sleep Ring", "Pedometer", "HR Monitor"],
  Computing: ["Mechanical Keyboard", "Wireless Mouse", "USB-C Hub", "Monitor Stand", "Webcam", "Docking Station"],
  Lighting: ["LED Strip", "Floor Lamp", "Reading Light", "Pendant Lamp", "Night Light", "Grow Light"],
};

function productName(i: number): string {
  const category = CATEGORIES[i % CATEGORIES.length];
  const roots = PRODUCT_ROOTS[category];
  return `${roots[i % roots.length]} ${String.fromCharCode(65 + (i % 26))}${pad((i / 26) % 26 + 1, 2)}`;
}

const STATUSES = ["delivered", "shipped", "processing", "cancelled", "returned"];
const statusWeights = [0.62, 0.18, 0.1, 0.06, 0.04];

function weightedStatus(): string {
  const r = rand();
  let acc = 0;
  for (let i = 0; i < STATUSES.length; i++) {
    acc += statusWeights[i];
    if (r < acc) return STATUSES[i];
  }
  return STATUSES[0];
}

const CHANNELS = ["web", "mobile", "marketplace", "store"];

// ---- SQL generation ----------------------------------------------------------

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlString(s: string): string {
  return `'${esc(s)}'`;
}

function dateFor(daysBack: number): string {
  const d = new Date(2021, 0, 1);
  d.setDate(d.getDate() + daysBack);
  return d.toISOString().slice(0, 10);
}

const itemChunks: string[] = [];

// Each statement is returned separately. Running the seed as one giant
// string inside db.run() was the trigger for the "memory access out of
// bounds" failure; per-statement execution keeps every allocation small.
export function buildSeedStatements(): string[] {
  const lines: string[] = [
    "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT, country TEXT, joined_at TEXT, segment TEXT);",
    "CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT, name TEXT, category TEXT, price REAL, created_at TEXT);",
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, order_date TEXT, status TEXT, channel TEXT, total REAL);",
    "CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, quantity INTEGER, unit_price REAL);",
    "CREATE TABLE reviews (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, rating INTEGER, comment TEXT);",
  ];

  // customers
  for (let i = 1; i <= 2000; i++) {
    const [city, country] = CITIES[i % CITIES.length];
    lines.push(
      `INSERT INTO customers VALUES (${i},${sqlString(customerName(i))},${sqlString(city)},${sqlString(country)},${sqlString(dateFor(Math.floor(rand() * 1800)))},${sqlString(weightedSegment())});`
    );
  }

  // products
  for (let i = 1; i <= 400; i++) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const price = Math.round((4.99 + rand() * 395) * 100) / 100;
    lines.push(
      `INSERT INTO products VALUES (${i},${sqlString(`SKU-${pad(i, 4)}`)},${sqlString(productName(i))},${sqlString(category)},${price},${sqlString(dateFor(1700 + Math.floor(rand() * 300)))});`
    );
  }

  // orders — the big one. Each INSERT carries at most 250 tuples so no single
  // statement balloons; total INSERT count stays modest (~200) so the seed
  // fits comfortably in the WASM heap.
  let orderId = 1;
  for (let start = 1; start <= 50000; start += 250) {
    const tuples: string[] = [];
    for (let i = start; i < Math.min(start + 250, 50001); i++) {
      const customerId = 1 + Math.floor(rand() * 2000);
      const daysBack = Math.floor(rand() * 1826);
      const status = weightedStatus();
      const channel = pick(CHANNELS);
      const total = Math.round((9.99 + rand() * 1490) * 100) / 100;
      tuples.push(`(${orderId},${customerId},${sqlString(dateFor(daysBack))},${sqlString(status)},${sqlString(channel)},${total})`);
      orderId++;
    }
    lines.push(`INSERT INTO orders (id,customer_id,order_date,status,channel,total) VALUES ${tuples.join(",")};`);
  }

  // order_items — 2-4 items per order. Grouped into INSERTs of at most 400
  // tuples each so no statement is enormous.
  let itemId = 1;
  for (let oid = 1; oid <= 50000; oid++) {
    const count = 2 + Math.floor(rand() * 3); // 2..4
    for (let j = 0; j < count; j++) {
      const productId = 1 + Math.floor(rand() * 400);
      const quantity = 1 + Math.floor(rand() * 5);
      const unitPrice = Math.round((4.99 + rand() * 395) * 100) / 100;
      itemChunks.push(`(${itemId},${oid},${productId},${quantity},${unitPrice})`);
      if (itemChunks.length === 400) {
        lines.push(`INSERT INTO order_items (id,order_id,product_id,quantity,unit_price) VALUES ${itemChunks.join(",")};`);
        itemChunks.length = 0;
      }
      itemId++;
    }
  }
  if (itemChunks.length) {
    lines.push(`INSERT INTO order_items (id,order_id,product_id,quantity,unit_price) VALUES ${itemChunks.join(",")};`);
    itemChunks.length = 0;
  }

  // reviews — roughly a third of delivered orders get a review
  let reviewId = 1;
  const reviewChunks: string[] = [];
  const comments = [
    "Works as advertised",
    "Great value for the price",
    "Solid build quality",
    "Better than expected",
    "Good but packaging could improve",
    "Exactly what I needed",
    "Fast delivery, happy customer",
    "Does the job",
    "Would buy again",
    "Decent for the price",
  ];
  for (let oid = 1; oid <= 50000; oid++) {
    if (rand() < 0.36) {
      const productId = 1 + Math.floor(rand() * 400);
      const rating = 2 + Math.floor(rand() * 4); // 2..5
      reviewChunks.push(`(${reviewId},${oid},${productId},${rating},${sqlString(pick(comments))})`);
      if (reviewChunks.length === 400) {
        lines.push(`INSERT INTO reviews (id,order_id,product_id,rating,comment) VALUES ${reviewChunks.join(",")};`);
        reviewChunks.length = 0;
      }
      reviewId++;
    }
  }
  if (reviewChunks.length) {
    lines.push(`INSERT INTO reviews (id,order_id,product_id,rating,comment) VALUES ${reviewChunks.join(",")};`);
  }

  // indexes
  lines.push(
    "CREATE INDEX idx_orders_customer ON orders (customer_id);",
    "CREATE INDEX idx_orders_date ON orders (order_date);",
    "CREATE INDEX idx_items_order ON order_items (order_id);",
    "CREATE INDEX idx_items_product ON order_items (product_id);",
    "CREATE INDEX idx_reviews_order ON reviews (order_id);"
  );

  lines.push("COMMIT;");
  return lines;
}
