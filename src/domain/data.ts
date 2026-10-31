import type { Participant, Venue } from "./types";

// Fictional restaurants, illustrative prices/menus/walking times. Photography is illustrative.
const photo = (id: string) => `/images/${id}.jpg`;

export const initialVenueId = "juniper";
export const tasteOptions = [
  "Italian",
  "Mediterranean",
  "Japanese",
  "Mexican",
  "Korean",
  "Seasonal",
];
export const restrictionOptions = [
  "Vegetarian",
  "Vegan",
  "Gluten-free",
  "Nut-free",
];
export const participantColors = [
  "#a46c49",
  "#7d8860",
  "#8b6a86",
  "#497f86",
  "#b58444",
  "#a45f65",
];

export const defaultParticipant: Participant = {
  id: "you",
  name: "You",
  color: participantColors[0],
  tastes: ["Italian", "Seasonal"],
  budget: 65,
  restrictions: [],
};

export const venues: Venue[] = [
  {
    id: "juniper",
    name: "Juniper & Rye",
    cuisine: "Italian · seasonal",
    neighborhood: "Fort Greene",
    price: 48,
    rating: 4.8,
    walkMinutes: 12,
    description:
      "Handmade pasta. Candlelit corners. A little longer at the table.",
    story:
      "A neighborhood dining room made for unhurried evenings. Seasonal plates arrive from an open kitchen, the wine is poured generously, and there is always room for one more story.",
    tags: ["Italian", "Seasonal", "Cozy", "Date night", "Pasta"],
    dietary: ["Vegetarian", "Gluten-free"],
    image: "/images/restaurant.jpg",
    accent: "#B8783E",
    coordinates: { x: 56, y: 48 },
    menu: [
      {
        name: "Burrata & late tomatoes",
        description: "Basil oil, sourdough, a little sea salt",
        price: 16,
      },
      {
        name: "Brown butter ravioli",
        description: "Roasted squash, sage, aged pecorino",
        price: 28,
      },
      {
        name: "The house tiramisu",
        description: "Espresso-soaked, made every morning",
        price: 12,
      },
    ],
  },
  {
    id: "olive",
    name: "Olive & Ember",
    cuisine: "Mediterranean",
    neighborhood: "Clinton Hill",
    price: 42,
    rating: 4.7,
    walkMinutes: 16,
    description: "A wood-fired feast for the middle of the table.",
    story:
      "Warm bread, bright herbs, and the scent of the wood oven. Order a little of everything and pass it around; the best conversations happen between the plates.",
    tags: ["Mediterranean", "Sharing plates", "Vegetables", "Lively"],
    dietary: ["Vegetarian", "Vegan", "Gluten-free"],
    image: photo("photo-1414235077428-338989a2e8c0"),
    accent: "#69744C",
    coordinates: { x: 73, y: 35 },
    menu: [
      {
        name: "Whipped hummus",
        description: "Chickpeas, tahini, warm flatbread",
        price: 12,
      },
      {
        name: "Fire-roasted cauliflower",
        description: "Herbed lentils, preserved lemon",
        price: 24,
      },
      {
        name: "Orange blossom rice pudding",
        description: "Citrus, cinnamon, rose petals",
        price: 10,
      },
    ],
  },
  {
    id: "momo",
    name: "Momo House",
    cuisine: "Japanese",
    neighborhood: "Fort Greene",
    price: 36,
    rating: 4.6,
    walkMinutes: 8,
    description: "Steam rising, noodles twirling, everyone leaning in.",
    story:
      "A tiny counter and a handful of wooden tables. Rich broths simmer all afternoon, then the room fills with the gentle clatter of bowls and the first sip of cold tea.",
    tags: ["Japanese", "Noodles", "Casual", "Comfort food"],
    dietary: ["Vegetarian", "Vegan", "Nut-free"],
    image: photo("photo-1555396273-367ea4eb4db5"),
    accent: "#8B5142",
    coordinates: { x: 37, y: 36 },
    menu: [
      {
        name: "Crisp vegetable gyoza",
        description: "Ginger, cabbage, bright ponzu",
        price: 11,
      },
      {
        name: "Mushroom miso ramen",
        description: "Slow-simmered broth, spring onion",
        price: 22,
      },
      {
        name: "Black sesame ice cream",
        description: "A small bowl, a perfect finish",
        price: 8,
      },
    ],
  },
  {
    id: "casa",
    name: "Casa Nopal",
    cuisine: "Mexican",
    neighborhood: "Boerum Hill",
    price: 32,
    rating: 4.7,
    walkMinutes: 18,
    description: "Fresh tortillas and a very good reason to stay for another.",
    story:
      "Colorful tiles, an open window, and handmade tortillas still warm from the comal. The menu follows the market, with plenty of bright, generous dishes for the whole table.",
    tags: ["Mexican", "Tacos", "Lively", "Sharing plates"],
    dietary: ["Vegetarian", "Vegan", "Gluten-free", "Nut-free"],
    image: photo("photo-1552566626-52f8b828add9"),
    accent: "#AC6242",
    coordinates: { x: 29, y: 71 },
    menu: [
      {
        name: "Guacamole de la casa",
        description: "Avocado, lime, fresh corn tostadas",
        price: 11,
      },
      {
        name: "Wild mushroom tacos",
        description: "Three corn tortillas, salsa verde",
        price: 19,
      },
      {
        name: "Cinnamon churros",
        description: "Warm chocolate for dipping",
        price: 9,
      },
    ],
  },
  {
    id: "sunday",
    name: "Sunday People",
    cuisine: "Seasonal · American",
    neighborhood: "Brooklyn Heights",
    price: 58,
    rating: 4.9,
    walkMinutes: 22,
    description:
      "The kind of dinner that turns an ordinary day into an occasion.",
    story:
      "Linen napkins, natural wine, and thoughtful plates that let the ingredients speak. The dining room feels like a friend’s home, if your friend happened to be a very good cook.",
    tags: ["Seasonal", "American", "Quiet", "Date night"],
    dietary: ["Vegetarian", "Gluten-free", "Nut-free"],
    image: photo("photo-1514933651103-005eec06c04b"),
    accent: "#8E7E54",
    coordinates: { x: 15, y: 45 },
    menu: [
      {
        name: "Market greens",
        description: "Little gems, herbs, cider vinaigrette",
        price: 16,
      },
      {
        name: "Roast chicken for two",
        description: "Golden potatoes, pan juices, greens",
        price: 52,
      },
      {
        name: "Pear & vanilla tart",
        description: "Flaky pastry, crème fraîche",
        price: 13,
      },
    ],
  },
  {
    id: "bomi",
    name: "Bomi",
    cuisine: "Korean",
    neighborhood: "Prospect Heights",
    price: 46,
    rating: 4.8,
    walkMinutes: 20,
    description: "Small plates, big warmth, and a table full of possibilities.",
    story:
      "A modern Korean kitchen with a generous spirit. Banchan lands first, then sizzling stone bowls, crisp pancakes, and dishes that taste even better when everyone has a bite.",
    tags: ["Korean", "Sharing plates", "Lively", "Comfort food"],
    dietary: ["Vegetarian", "Vegan", "Gluten-free", "Nut-free"],
    image: photo("photo-1516211697506-8360dbcfe9a4"),
    accent: "#65766C",
    coordinates: { x: 77, y: 75 },
    menu: [
      {
        name: "Seasonal banchan",
        description: "Six small plates from the kitchen",
        price: 14,
      },
      {
        name: "Hot stone bibimbap",
        description: "Market vegetables, rice, gochujang",
        price: 25,
      },
      {
        name: "Sweet rice pancakes",
        description: "Brown sugar, cinnamon, vanilla cream",
        price: 10,
      },
    ],
  },
];
