const form = document.querySelector('#chat-form'), input = document.querySelector('#question');
const messages = document.querySelector('#messages'), status = document.querySelector('#status');
let busy = false;
function element(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
function message(role, text) {
  document.querySelector('#welcome').hidden = true;
  const card = element('article', '', `message ${role}`);
  card.append(element('h3', role === 'user' ? 'YOU' : 'PROPERTY DESK'));
  if (text) card.append(element('p', text)); messages.append(card); return card;
}
function lock(value) { busy = value; document.querySelectorAll('button').forEach(button => button.disabled = value); input.disabled = value; status.textContent = value ? 'Finding evidence and preparing your answer…' : ''; }
async function ask(question) {
  if (busy || !question.trim()) return;
  message('user', question); input.value = ''; lock(true);
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), signal: AbortSignal.timeout(45000) });
    const data = await response.json();
    const card = message(response.ok ? 'assistant' : 'error', data.message);
    for (const record of data.evidence ?? []) {
      const url = new URL(record.url);
      if (url.protocol !== 'https:' || !['wasalt.sa', 'darglobal.co.uk'].includes(url.hostname)) continue;
      const link = element('a', record.title, 'source-card');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const offer = record.offer;
      const price = Number.isFinite(offer.amount) ? `${offer.amount.toLocaleString()} ${offer.currency ?? ''}${offer.period ? ' per ' + offer.period : ''}` : 'Price not recorded';
      link.append(element('small', `${record.city ?? 'Location not recorded'} · ${price}`));
      link.append(element('small', 'Snapshot evidence · availability unverified'));
      if (record.quality?.warnings?.length) link.append(element('small', 'Some details need review.'));
      card.append(link);
    }
    if (data.statements) {
      if (data.total_matches > data.sources.length) card.append(element('p', `Showing selected evidence from ${data.total_matches} matching records.`, 'note'));
      for (const statement of data.statements) {
        const numbers = statement.source_ids.map(id => data.sources.findIndex(s => s.id === id) + 1);
        card.append(element('p', `${statement.text} [${numbers.join(', ')}]`));
      }
      data.sources.forEach((source, i) => {
        const link = element('a', `${i + 1}. ${source.title}`, 'source-card');
        const url = new URL(source.url);
        if (url.protocol !== 'https:' || !['wasalt.sa', 'darglobal.co.uk'].includes(url.hostname)) return;
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.append(element('small', `${source.source === 'wasalt' ? 'Wasalt · Listing' : 'DarGlobal · Project'} · Collected ${new Date(source.collected_at).toLocaleDateString()}`));
        if (source.quality?.warnings?.length) link.append(element('small', 'Some information is uncertain or needs review.'));
        card.append(link);
      });
      card.append(element('p', 'Based on collected pages. Availability is not verified.', 'note'));
    }
  } catch { message('error', 'Could not get an answer. Please check your connection and try again.'); }
  finally { lock(false); input.focus(); messages.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
form.addEventListener('submit', event => { event.preventDefault(); ask(input.value.trim()); });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } });
document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => ask(button.dataset.question)));
document.querySelector('#reset').addEventListener('click', async () => {
  lock(true);
  try {
    const response = await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error();
    messages.replaceChildren(); document.querySelector('#welcome').hidden = false; input.value = '';
  } catch { message('error', 'Could not reset the conversation. Please try again.'); }
  finally { lock(false); input.focus(); }
});
