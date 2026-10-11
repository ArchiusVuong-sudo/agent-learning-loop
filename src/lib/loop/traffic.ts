/** Synthetic customer messages. Request ids are stable so agents can cite them as evidence. */
export interface TrafficRequest {
  id: string;
  message: string;
}

/** Production-style traffic that runs on prompt v1 to produce the first traces. */
export const SEED_TRAFFIC: TrafficRequest[] = [
  { id: 'S01', message: "Hi, this is Imani Okafor. Where is my order ORD-20431? I need the boots for a trip next weekend." },
  { id: 'S02', message: "Theo Lindqvist here. The trail running shoes from order ORD-20457 don't suit me. They're unworn and still in the box. Can I send them back?" },
  { id: 'S03', message: "I opened my trail headphones 20 days ago, can I still return them? Order ORD-20512, Rowan Pike." },
  { id: 'S04', message: "Priya Raman, order ORD-20533. I tried the handheld GPS on two hikes and it's not for me. I'd like to return it." },
  { id: 'S05', message: "Mateo Duarte. I opened the headlamp from ORD-20548 and it's too dim for me. Can I return it and get my money back?" },
  { id: 'S06', message: "This is Hana Sato. The rain shell from ORD-20561 runs small. Please start a return." },
  { id: 'S07', message: "Felix Brandt, order ORD-20577. I changed my mind about the fleece, can I return it for a refund?" },
  { id: 'S08', message: "Amara Nwosu here. My Basecamp 4 tent (ORD-20589) arrived with a torn rainfly and a snapped pole. I want a full refund today." },
  { id: 'S09', message: "Jonah Whitley. The camp stove from ORD-20594 arrived with a cracked burner. What can you do?" },
  { id: 'S10', message: "Leila Haddad, order ORD-20602. The 65L backpack came with a ripped hip belt, clearly from shipping. Refund please." },
  { id: 'S11', message: "I'm Oskar Nilsen. Please cancel my Trail Club membership, I don't hike enough to use it." },
  { id: 'S12', message: "Zoe Marchetti. Cancel my Trail Club membership and refund this year's fee, I never used it." },
  { id: 'S13', message: "Ravi Iyer, order ORD-20618. I never opened the bottle set. Can I still return it?" },
  { id: 'S14', message: "Elena Petrova. I mailed back the hiking boots from ORD-20624 last week. When will I see the refund?" },
  { id: 'S15', message: "Kai Halvorsen. The down jacket from ORD-20633 is too big. Can I swap it for a medium?" },
  { id: 'S16', message: "Hi, Nadia Rahman. What have I ordered recently? I can't find the confirmation email." },
  { id: 'S17', message: "Caleb Moreau, order ORD-20645. The locking clip on one of my trekking poles snapped on the trail. What are my options?" },
  { id: 'S18', message: "Sofia Lindgren. I opened the action camera from ORD-20652 but it doesn't fit my helmet mount. Can I return it?" },
  { id: 'S19', message: "Ibrahim Diallo. Order ORD-20667, the GPS watch. I've used it a few times and want to return it." },
  { id: 'S20', message: "Mei Chen, ORD-20671. I'd like to return the softshell jacket, tags are still on." },
  { id: 'S21', message: "Lucas Ferreira. I set up the Ultralight 2 tent from ORD-20688 once in my yard and it's smaller than I thought. Can I return it?" },
  { id: 'S22', message: "Ana Kovac. The headlamp from ORD-20694 arrived with a cracked lens. Can I get a refund?" },
  { id: 'S23', message: "Tomas Novak. Can you pause my Trail Club membership for the winter?" },
  { id: 'S24', message: "Yara Lund. I opened the trail headphones from ORD-20705 five days ago and they hurt my ears. I want to return them." },
];

/** Held-out traffic: never shown to the eval author or the learner. Used for the shadow run. */
export const HELD_OUT_TRAFFIC: TrafficRequest[] = [
  { id: 'H01', message: "Elena Petrova again. I unboxed the GPS watch from ORD-20712 a couple of weeks ago and don't like it. Return please." },
  { id: 'H02', message: "Noor Aziz, ORD-20718. The river sandals rub my heel. I'd like to send them back." },
  { id: 'H03', message: "Bram Visser. My sleeping pad from ORD-20723 arrived with a puncture straight out of the box." },
  { id: 'H04', message: "Ines Carvalho. The Basecamp 6 tent from ORD-20731 was crushed in shipping, two poles are bent. I want my money back." },
  { id: 'H05', message: "Dmitri Volkov. Please stop charging me for Trail Club, I want out." },
  { id: 'H06', message: "Ruth Abebe. Order ORD-20740, the approach shoes. Never worn, I'd like to return them." },
  { id: 'H07', message: "Sven Aalto. I opened the trail headphones from ORD-20746 last week, the sound is too bass heavy. Can I return them?" },
  { id: 'H08', message: "Mira Joshi. How long does a refund take once you get my return?" },
];

export interface GoldenCase {
  id: string;
  title: string;
  input: string;
  must: string[];
  mustNot: string[];
  expectedToolPath: string[];
}

/** Hand-written cases v1 already gets right. A candidate prompt must keep passing them. */
export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: 'G1',
    title: 'Order status, in transit',
    input: 'Hi, Lena Fischer here. Has my order ORD-20755 shipped yet?',
    must: ['Says the order is in transit (not yet delivered)'],
    mustNot: ['Offers a return or refund for this order'],
    expectedToolPath: ['mcp__store__lookup_order'],
  },
  {
    id: 'G2',
    title: 'Unworn apparel inside the window',
    input: 'Omar Saleh. I want to return the trail running vest from ORD-20761, never worn.',
    must: ['Starts a return and gives the return id', 'Says the refund is the full price with no restocking fee'],
    mustNot: ['Mentions a restocking fee being charged'],
    expectedToolPath: ['mcp__store__create_return'],
  },
  {
    id: 'G3',
    title: 'Refund timing',
    input: 'Once you receive my returned boots, how long until the refund shows up?',
    must: ['Says refunds take 5-7 business days after the item is received'],
    mustNot: ['Promises an instant or same-day refund'],
    expectedToolPath: ['mcp__store__search_policy'],
  },
  {
    id: 'G4',
    title: 'Size exchange inside the window',
    input: 'Grace Odhiambo, ORD-20768. The leather hiking boots are half a size too small. Can I exchange them?',
    must: ['Explains the exchange: a return with reason wrong_size plus a new order, at no cost'],
    mustNot: ['Says exchanges are not allowed'],
    expectedToolPath: [],
  },
  {
    id: 'G5',
    title: 'Damage under $200',
    input: 'Henrik Dahl. The camp cookset from ORD-20774 arrived dented. Can I get a refund?',
    must: ['Starts a return for shipping damage and gives the return id', 'Says the refund is the full price'],
    mustNot: ['Hands the case to a human agent'],
    expectedToolPath: ['mcp__store__create_return'],
  },
];

/** Suggested messages for the Try box. All of them are recorded, so they also work in replay mode. */
export const TRY_SUGGESTIONS: string[] = [
  'I opened my trail headphones 20 days ago, can I still return them?',
  'Bram Visser here. Is my sleeping pad order ORD-20723 eligible for a refund? It arrived punctured.',
  'Can you cancel my Trail Club membership? This is Oskar Nilsen.',
];
