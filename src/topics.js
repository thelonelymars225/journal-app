// Default life topics. `about` is what the model reads when deciding whether an
// entry fits, so a few concrete words there sort better than the name alone.
// `keywords` drive the instant fallback used before the model has loaded.
export const DEFAULT_TOPICS = [
  {
    id: 'career', name: 'Career & Work', color: '#4f7cac',
    about: 'work, career, a job, a boss or coworkers, or professional goals',
    keywords: ['work', 'job', 'career', 'boss', 'manager', 'coworker', 'colleague', 'office', 'meeting', 'project', 'promotion', 'interview', 'salary', 'deadline', 'client', 'team', 'quit', 'hired', 'fired', 'resume', 'startup', 'business'],
  },
  {
    id: 'love', name: 'Love & Relationships', color: '#c8577a',
    about: 'romance, dating, a partner, a crush, a breakup, or a romantic relationship',
    keywords: ['love', 'date', 'dating', 'boyfriend', 'girlfriend', 'partner', 'husband', 'wife', 'crush', 'romantic', 'relationship', 'breakup', 'broke up', 'kiss', 'marriage', 'married', 'engaged', 'ex', 'heart'],
  },
  {
    id: 'family', name: 'Family', color: '#c98a3b',
    about: 'family members, parents, siblings, children, or home life',
    keywords: ['mom', 'dad', 'mother', 'father', 'parents', 'brother', 'sister', 'sibling', 'son', 'daughter', 'kids', 'family', 'grandma', 'grandpa', 'cousin', 'aunt', 'uncle'],
  },
  {
    id: 'friends', name: 'Friends & Social', color: '#3f9a8c',
    about: 'friends, social life, parties, or hanging out with people',
    keywords: ['friend', 'friends', 'party', 'hang out', 'hung out', 'social', 'group', 'dinner with', 'birthday', 'lonely', 'met up'],
  },
  {
    id: 'health', name: 'Health & Body', color: '#5a9a4b',
    about: 'physical health, exercise, sleep, food, illness, or the body',
    keywords: ['gym', 'workout', 'run', 'running', 'exercise', 'sleep', 'slept', 'tired', 'sick', 'doctor', 'diet', 'ate', 'eating', 'weight', 'pain', 'headache', 'health', 'walk', 'yoga'],
  },
  {
    id: 'mind', name: 'Mind & Emotions', color: '#8a6bbf',
    about: 'feelings, mood, stress, anxiety, mental health, or inner thoughts',
    keywords: ['feel', 'feeling', 'anxious', 'anxiety', 'stress', 'stressed', 'sad', 'happy', 'angry', 'depressed', 'overwhelmed', 'grateful', 'calm', 'cry', 'cried', 'therapy', 'mood', 'worried'],
  },
  {
    id: 'money', name: 'Money', color: '#6f8f3a',
    about: 'money, finances, spending, saving, debt, or bills',
    keywords: ['money', 'spent', 'spend', 'save', 'saving', 'savings', 'budget', 'rent', 'bill', 'bills', 'debt', 'loan', 'invest', 'paid', 'pay', 'expensive', 'afford'],
  },
  {
    id: 'growth', name: 'Growth & Learning', color: '#b0613e',
    about: 'learning, studying, school, habits, goals, or self-improvement',
    keywords: ['learn', 'learning', 'study', 'studying', 'class', 'course', 'book', 'read', 'reading', 'habit', 'goal', 'goals', 'improve', 'practice', 'school', 'exam', 'university'],
  },
  {
    id: 'fun', name: 'Hobbies & Fun', color: '#3d86b8',
    about: 'hobbies, creativity, games, music, movies, or travel',
    keywords: ['game', 'gaming', 'music', 'movie', 'film', 'show', 'trip', 'travel', 'vacation', 'paint', 'draw', 'guitar', 'hobby', 'concert', 'cook', 'cooking'],
  },
];

export const PALETTE = ['#4f7cac', '#c8577a', '#c98a3b', '#3f9a8c', '#5a9a4b', '#8a6bbf', '#6f8f3a', '#b0613e', '#3d86b8', '#9a5c8a', '#7a7a3a', '#5c6f9a'];

// Instant, rough sorting by keyword hits. Used until the model is ready, or if it can't load.
export function keywordClassify(text, topics) {
  const lower = ` ${text.toLowerCase()} `;
  const scores = {};
  for (const t of topics) {
    const words = t.keywords?.length ? t.keywords : t.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
    let hits = 0;
    for (const w of words) {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      hits += (lower.match(re) || []).length;
    }
    scores[t.id] = Math.min(1, hits / 3);
  }
  return scores;
}

// Turn per-topic scores into the topics an entry is filed under.
export function pickTopics(scores, { threshold = 0.5, max = 3 } = {}) {
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const picked = ranked.filter(([, s]) => s >= threshold).slice(0, max).map(([id]) => id);
  if (!picked.length && ranked.length && ranked[0][1] >= threshold / 2) picked.push(ranked[0][0]);
  return picked;
}

// Extra topics the app watches for in the background. When several entries
// clearly fit one that isn't in your list, it's offered as a suggestion.
export const SUGGESTION_POOL = [
  { name: 'Travel', about: 'travel, trips, flights, or visiting new places', keywords: ['trip', 'travel', 'flight', 'airport', 'hotel', 'vacation', 'visited', 'abroad', 'passport'] },
  { name: 'Pets', about: 'pets, a dog, a cat, or other animals', keywords: ['dog', 'cat', 'puppy', 'kitten', 'pet', 'vet', 'walked the dog'] },
  { name: 'Home', about: 'home, an apartment, moving house, chores, or decorating', keywords: ['apartment', 'house', 'moving', 'move', 'chores', 'clean', 'cleaning', 'roommate', 'furniture', 'landlord'] },
  { name: 'Faith & Spirituality', about: 'faith, religion, prayer, or spirituality', keywords: ['pray', 'prayer', 'god', 'faith', 'church', 'mosque', 'temple', 'spiritual', 'ramadan', 'meditate', 'meditation'] },
  { name: 'Food & Cooking', about: 'food, cooking, recipes, or restaurants', keywords: ['cook', 'cooked', 'cooking', 'recipe', 'restaurant', 'dinner', 'lunch', 'breakfast', 'baked', 'meal'] },
  { name: 'Creativity', about: 'creative work like writing, art, music making, or design', keywords: ['write', 'writing', 'draw', 'drawing', 'paint', 'painting', 'song', 'poem', 'design', 'sketch'] },
  { name: 'Sports', about: 'playing or watching sports, matches, or a team', keywords: ['football', 'soccer', 'basketball', 'match', 'game', 'team', 'tennis', 'score', 'league'] },
  { name: 'Parenting', about: 'raising children, parenting, or being a parent', keywords: ['my son', 'my daughter', 'my kids', 'toddler', 'baby', 'parenting', 'school pickup', 'bedtime'] },
  { name: 'Grief & Loss', about: 'grief, loss, death, or missing someone who is gone', keywords: ['died', 'death', 'funeral', 'grief', 'passed away', 'miss him', 'miss her', 'loss'] },
  { name: 'Gratitude', about: 'gratitude, being thankful, or appreciating good things', keywords: ['grateful', 'thankful', 'gratitude', 'blessed', 'appreciate'] },
  { name: 'Dreams', about: 'dreams I had while sleeping, or nightmares', keywords: ['dreamt', 'dreamed', 'nightmare', 'in my dream', 'last night i dreamt'] },
  { name: 'Goals & Plans', about: 'plans for the future, goals, resolutions, or big decisions', keywords: ['plan', 'plans', 'goal', 'goals', 'resolution', 'decide', 'decision', 'future', 'next year'] },
  { name: 'Nature & Outdoors', about: 'nature, hiking, the outdoors, the beach, or the weather', keywords: ['hike', 'hiking', 'beach', 'mountain', 'park', 'camping', 'sunset', 'ocean', 'rain', 'snow'] },
  { name: 'Self-image', about: 'confidence, self-esteem, how I see myself, or my appearance', keywords: ['confidence', 'confident', 'insecure', 'self-esteem', 'ugly', 'mirror', 'appearance', 'proud of myself'] },
  { name: 'Technology', about: 'technology, computers, coding, apps, or gadgets', keywords: ['code', 'coding', 'programming', 'computer', 'laptop', 'app', 'phone', 'software', 'ai'] },
  { name: 'Community', about: 'volunteering, community, neighbors, or helping others', keywords: ['volunteer', 'volunteering', 'community', 'neighbor', 'neighbors', 'charity', 'donate'] },
].map((t) => ({ ...t, id: `pool:${t.name.toLowerCase().replace(/[^a-z]+/g, '-')}` }));
