import { h } from '../utils.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { t, getLang } from '../i18n.js';
import { openDialog } from './dialog.js';
import { app } from '../app.js';
import { LOGO_SVG } from '../logo.js';
import { auth } from '../auth.js';

const STARTER = [
  ['starter.personal', 'blue', 'home'], ['starter.work', 'indigo', 'briefcase'], ['starter.study', 'purple', 'graduation-cap'],
  ['starter.finance', 'green', 'wallet'], ['starter.health', 'red', 'stethoscope'], ['starter.family', 'pink', 'users'],
  ['starter.travel', 'teal', 'plane'], ['starter.ids', 'amber', 'id-card'],
];

export function openWelcome() {
  return new Promise((resolve) => {
    let starter = true;
    const build = () => {
      const sw = h('span', { class: `switch ${starter ? 'on' : ''}` });
      const body = h('div', { class: 'welcome' },
        h('div', { class: 'logo-big', html: LOGO_SVG }),
        h('div', { class: 'lang-switch seg' },
          h('button', { class: getLang() === 'en' ? 'on' : '', onclick: () => { app.setLanguage('en'); dlg.close(); openWelcome().then(resolve); } }, 'English'),
          h('button', { class: getLang() === 'ar' ? 'on' : '', onclick: () => { app.setLanguage('ar'); dlg.close(); openWelcome().then(resolve); } }, 'العربية')),
        h('h1', { text: t('welcome.title') }),
        h('p', { text: t('welcome.subtitle') }),
        h('div', { class: 'features' },
          h('div', {}, icon('wifi-off'), t('welcome.feature1')), h('div', {}, icon('search'), t('welcome.feature2')),
          h('div', {}, icon('cloud'), t('welcome.feature3')), h('div', {}, icon('globe'), t('welcome.feature4'))),
        h('div', { class: 'switch-row', style: { textAlign: 'start' }, onclick: () => { starter = !starter; sw.classList.toggle('on', starter); } },
          h('div', {}, h('div', { class: 't', text: t('welcome.starter') }), h('div', { class: 'd', text: t('welcome.starterHint') })), sw));
      return body;
    };
    const dlg = openDialog({
      body: build(), size: 'md', closable: false,
      actions: [
        ...(auth.isConfigured() && !auth.isSignedIn() ? [{ label: t('action.signIn'), icon: 'microsoft', start: true, onClick: async () => {
          if (starter && !store.liveFolders().length) for (const [k, color, ic] of STARTER) await store.createFolder({ name: t(k), color, icon: ic });
          await store.setSetting('welcomeDone', true);
          resolve(true);
          app.signIn();
        } }] : []),
        { label: t('welcome.start'), primary: true, onClick: async () => {
          if (starter && !store.liveFolders().length) for (const [k, color, ic] of STARTER) await store.createFolder({ name: t(k), color, icon: ic });
          await store.setSetting('welcomeDone', true);
          resolve(true);
        } }],
      onClose: () => resolve(false),
    });
    dlg.el.dataset.noEsc = '1';
  });
}
