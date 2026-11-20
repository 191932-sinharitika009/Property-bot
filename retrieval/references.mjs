const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
export const STARTER_OPTIONS = [
  'Riyadh villas for sale below SAR 2 million',
  'Les Vagues bedroom options',
  'Annual apartment rentals in Jeddah',
  'DarGlobal projects with a swimming pool',
];

// Resolve explicit references to displayed source cards or initial starter options.
// IDs are session context, never cached answers or facts copied from model prose.
export function resolveReference(question, context = {}) {
  if (typeof question !== 'string' || question.length > 2000) return null;
  const text = question.trim().toLowerCase().replace(/^yes[, ]+/, '');
  const referenceIntent = /^(?:(?:please\s+)?(?:tell me|show me|what|how|more|details|describe|explain|expand|compare|is |does |can you)|(?:option|property|listing|project|#)\s*\d|(?:the )?(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))\b)/.test(text);
  const cardinal = text.match(/^(?:please\s+)?(?:tell me (?:more )?about\s+|what about\s+|explain\s+|describe\s+|show me\s+)?(\d+)[.!?]?$/);
  const matches = cardinal ? [[cardinal[0], cardinal[1]]] : [...text.matchAll(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\b(?=\s*(?:[.!?]?$|(?:one|option|starter|property|listing|project|card|and)\b))|(?:#|number\s+|option\s+|property\s+|listing\s+|project\s+)(\d+)\b/g)];
  if ((cardinal || referenceIntent) && matches.length) {
    if (matches.length !== 1) return { clarification: 'Please select one numbered property at a time.' };
    const value = matches[0][1] ?? matches[0][2];
    const number = ORDINALS[value] ?? parseInt(value, 10);
    const ids = context.displayed_ids ?? [];
    if (context.welcomeVisible === true && !ids.length) {
      if (number >= 1 && number <= STARTER_OPTIONS.length) return { starter_question: STARTER_OPTIONS[number - 1], number };
      return { clarification: 'There are four starter options. Please choose a number from 1 to 4.' };
    }
    if (/\b(?:starter|starting|welcome)\b/.test(text)) return { clarification: 'Choose New conversation to see the welcome suggestions.' };
    if (!ids.length) return { clarification: 'Which property do you mean? Please give its name.' };
    if (ids.length === 1 && number !== 1) return { clarification: 'The previous answer showed only one source card. Choose 1 or search for another property.' };
    if (!Number.isSafeInteger(number) || number < 1 || number > ids.length) return { clarification: `The previous answer showed ${ids.length} source cards. Choose a number from 1 to ${ids.length}.` };
    return { id: ids[number - 1], number };
  }
  if (/^(?:please\s+)?(?:tell me more[.!?]?$|more details[.!?]?$|show me more[.!?]?$|what (?:is|are) its\b|what about (?:it|that one)\b|does it\b|is it\b)/.test(text)) {
    const id = context.selected_id ?? (context.displayed_ids?.length === 1 ? context.displayed_ids[0] : null);
    return id ? { id } : { clarification: 'Which property would you like to know more about? Use its source-card number or project name.' };
  }
  return null;
}
