// Which Twenty events post to Slack #myynti, and how they read (Dealbot-style).
// Toggle `enabled`, edit `format`, or add rules; then:
//   sudo systemctl restart twenty-slack-relay
//
// Rule:
//   event:   "<object>.<operation>" exactly as Twenty sends
//   enabled: true/false
//   when:    optional (record, updatedFields) => boolean
//   format:  (record, ctx) => attachment object (Slack), or falsy to skip
//
// ctx = { link, actor, updatedFields, baseUrl, company, person, opportunity, pointOfContact }
//   company/person/opportunity/pointOfContact are resolved { name, link } when linked.
//
// Emoji policy (only at the end of the first line): new deal :clap:, won 🏆, lost :sadblob:.
// No emoji for anything else.

// Skip any event whose record/contact/company/body matches one of these.
// The website form's synthetic "Heartbeat Bot" monitor submissions are noise.
export const ignore = [/heartbeat bot/i];

const COLOR = { info: '#1d9bd1', won: '#2eb67d', lost: '#e01e5a' };

const euro = (r) => {
  const micros = r.amountMicros ?? r.amount?.amountMicros;
  const v = micros == null ? 0 : Number(micros) / 1_000_000;
  return `${(Number.isFinite(v) ? v : 0).toLocaleString('fi-FI')} €`;
};

const personName = (r) =>
  [r.nameFirstName ?? r.name?.firstName, r.nameLastName ?? r.name?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim() || 'Nimetön';

// Must match Twenty's opportunity `stage` options. Update if you rename stages.
const stageLabel = (s) =>
  ({
    LIIDIT: 'New',
    QUALIFIED: 'Qualified',
    MEETING: 'Meeting',
    PROPOSAL: 'Proposal',
    NEGOTIATION: 'Negotiation',
    CLOSED_WON: 'Closed Won',
    CLOSED_LOST: 'Closed Lost',
  })[s] ?? s;

const body = (lines) => lines.filter(Boolean).join('\n');

export const rules = [
  {
    event: 'opportunity.created',
    enabled: true,
    format: (r, ctx) => ({
      color: COLOR.info,
      pretext: 'Uusi kauppa lisätty! :clap:',
      title: r.name,
      title_link: ctx.link,
      text: body([
        `*Arvo:* ${euro(r)}`,
        r.stage && `*Vaihe:* ${stageLabel(r.stage)}`,
        ctx.pointOfContact && `*Yhteyshenkilö:* ${ctx.pointOfContact.name}`,
        ctx.company && `*Yritys:* ${ctx.company.name}`,
        ctx.actor && `*Lisäsi:* ${ctx.actor}`,
      ]),
    }),
  },
  {
    event: 'opportunity.updated',
    enabled: true,
    when: (_r, updated) => updated.includes('stage'),
    format: (r, ctx) => {
      const stage = String(r.stage ?? '');
      if (stage === 'CLOSED_WON')
        return {
          color: COLOR.won,
          pretext: 'Kauppa voitettu! 🏆',
          title: r.name,
          title_link: ctx.link,
          text: body([`*Arvo:* ${euro(r)}`, ctx.actor && `*Clousasi:* ${ctx.actor}`]),
        };
      if (stage === 'CLOSED_LOST')
        return {
          color: COLOR.lost,
          pretext: 'Kauppa hävitty :sadblob:',
          title: r.name,
          title_link: ctx.link,
          text: body([
            r.lostReason && `*Syy:* ${r.lostReason}`,
            ctx.actor && `*Merkitsi hävinneeksi:* ${ctx.actor}`,
          ]),
        };
      return {
        color: COLOR.info,
        pretext: 'Kaupan vaihe vaihtui',
        title: r.name,
        title_link: ctx.link,
        text: body([`*Vaihe:* ${stageLabel(stage)}`, ctx.actor && `*Muutti:* ${ctx.actor}`]),
      };
    },
  },
  {
    event: 'company.created',
    enabled: true,
    format: (r, ctx) => ({
      color: COLOR.info,
      pretext: 'Uusi yritys lisätty',
      title: r.name,
      title_link: ctx.link,
      text: body([ctx.actor && `*Lisäsi:* ${ctx.actor}`]),
    }),
  },
  {
    event: 'person.created',
    enabled: true,
    format: (r, ctx) => ({
      color: COLOR.info,
      pretext: 'Uusi henkilö lisätty',
      title: personName(r),
      title_link: ctx.link,
      text: body([
        ctx.company && `*Yritys:* ${ctx.company.name}`,
        r.emailsPrimaryEmail && `*Sähköposti:* ${r.emailsPrimaryEmail}`,
        ctx.actor && `*Lisäsi:* ${ctx.actor}`,
      ]),
    }),
  },
  {
    event: 'note.created',
    enabled: true,
    format: (r, ctx) => ({
      color: COLOR.info,
      pretext: 'Uusi muistiinpano',
      title: r.title || 'Muistiinpano',
      title_link: ctx.link,
      text: body([ctx.actor && `*Lisäsi:* ${ctx.actor}`]),
    }),
  },
  {
    event: 'task.created',
    enabled: true,
    format: (r, ctx) => ({
      color: COLOR.info,
      pretext: 'Uusi tehtävä',
      title: r.title || 'Tehtävä',
      title_link: ctx.link,
      text: body([ctx.actor && `*Lisäsi:* ${ctx.actor}`]),
    }),
  },
  {
    event: 'recordComment.created',
    enabled: true,
    format: (r, ctx) => {
      const target = ctx.opportunity || ctx.person || ctx.company;
      const text = (r.bodyMarkdown ?? r.body?.markdown ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
      return {
        color: COLOR.info,
        pretext: 'Uusi kommentti',
        title: target ? target.name : 'Kommentti',
        title_link: target ? target.link : ctx.link,
        text: body([text && `> ${text}`, ctx.actor && `*Kirjoitti:* ${ctx.actor}`]),
      };
    },
  },
];
