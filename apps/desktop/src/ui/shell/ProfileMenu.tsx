// Profile bubble (bottom of the rail) and its menu: name/company, the companies on this PC (B-072, desktop window only:
// one picked opens its window and this one goes to the tray, its agents keep working) and Settings. B-078: a "+" beside
// the company name opens the add menu in the same place – New company / Connect as my other device / Join a company as
// employee; each starts a new company whose first run opens that way (companies.open start). 16.11.2026: the "+" also
// imports an export as a new company (settings/CompaniesGroup.tsx), and two companies of the same name show their
// folder ("first", "company-2") under the name. In the phone layout, where
// the rail with its quota badges is hidden, the menu shows the same badges (QuotaRail). B-084 (decision 7): inside the
// Android app (once its port is here) the menu is the phone sheet – the photo, the name and one status line
// "<company> · <PC>" (a tap shows the app's PC picker), the companies this phone is paired with (their pictures, the
// current one ticked; a pick lets the app switch), "Add a company" (the app's scanner screens) and Settings. "Forget
// this phone" lives in Settings › Devices now.
// Owns: the bubble and menu. Never: edits the profile itself (the AI or Settings does), opens or switches a company
// itself (main does, through companies.open; on the phone the app, pwa/phone-companies.ts).

import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { CompanyEntry, CompanyStart } from '../../shared/model/companies.ts';
import { companyLabel } from '../../shared/model/companies.ts';
import { HumanAvatar, IconButton, Menu, paletteIndex } from '../lib/ui.tsx';
import type { MenuItem, MenuSection } from '../lib/ui.tsx';
import { initials } from '../lib/format.ts';
import { isMobile, settings } from '../lib/store.ts';
import { go } from '../lib/router.ts';
import { comboLabel } from '../lib/hotkeys.ts';
import { platform } from '../lib/platform.ts';
import { rpc } from '../lib/rpc.ts';
import { toastError } from '../lib/toasts.ts';
import { openFeedback } from '../feedback/popover-state.ts';
import { importCompany } from '../settings/CompaniesGroup.tsx';
import { isAndroidApp } from '../pwa/native.ts';
import { hasNativePort } from '../pwa/native-port.ts';
import { addCompany, phoneCompanies, phoneStatus, showPcs, statusLine, switchCompany } from '../pwa/phone-companies.ts';
import type { PhoneCompany } from '../pwa/phone-companies.ts';
import { QuotaRail } from './QuotaRail.tsx';

/** The command palette's Feedback: the header cell's menu (after its screenshot). */
export { openFeedback };

const ITEMS: MenuItem[] = [
  { label: 'Settings', hint: comboLabel('mod+,'), onSelect: () => go.settings() },
];

/** The companies on this PC, kept between openings: the menu opens at its full height, nothing grows under the pointer. */
const companies = signal<CompanyEntry[]>([]);

function loadCompanies(): void {
  if (platform !== 'desktop') return; // a phone or browser belongs to the company it is paired with
  rpc.call('companies.list').then((result) => { companies.value = result.companies; }, () => { /* the last list stays */ });
}

function openCompany(params: { id: string | null } | { create: true; start: CompanyStart }): void {
  rpc.call('companies.open', params).catch((error: unknown) => toastError(error, 'Could not open the company'));
}

/** The company menu's "+" (B-078): each one starts a new company folder; its first run opens that way (`--start=`). */
const ADD_ITEMS: MenuItem[] = [
  { label: 'New company', description: 'Your own, with its own first run', onSelect: () => openCompany({ create: true, start: 'new' }) },
  { label: 'Connect as my other device', description: 'The same company as on another PC – everything mirrored', onSelect: () => openCompany({ create: true, start: 'mine' }) },
  { label: 'Join a company as employee', description: 'Someone else\'s company, as one person there', onSelect: () => openCompany({ create: true, start: 'employee' }) },
  { label: 'Import a company', description: 'An export from Autark, as a new company here', onSelect: () => { void importCompany(); } }, // 16.11.2026
];

/** The companies (the current one ticked; one whose name another shares names its folder too); none where there is no list (a test profile, the PWA). */
function companySections(list: CompanyEntry[]): MenuSection[] {
  if (!list.length) return [];
  const shared = (label: string) => list.filter((other) => other.label === label).length > 1;
  return [{ items: list.map((company) => ({
    label: company.label,
    ...(shared(company.label) ? { description: company.folder } : {}),
    checked: company.current,
    onSelect: () => { if (!company.current) openCompany({ id: company.id }); },
  })) }];
}

/** A phone company's 24 px picture: its card photo, else its initials on a colour from its id. */
function CompanyPic(props: { company: PhoneCompany }) {
  const { avatar, id, name } = props.company;
  return (
    <span class="avatar company-pic" data-color={paletteIndex(id)} aria-hidden="true">
      {avatar ? <img src={avatar} alt="" /> : <span>{initials(name)}</span>}
    </span>
  );
}

const ADD_COMPANY: MenuItem = { label: 'Add a company', icon: 'plus', description: 'Scan or type another company\'s code', onSelect: () => { addCompany(); } };

/** The phone sheet's sections: the paired companies with "Add a company" under them, then Settings. */
function phoneSections(list: PhoneCompany[]): MenuSection[] {
  const rows: MenuItem[] = list.map((company) => ({
    label: company.name,
    lead: <CompanyPic company={company} />,
    checked: company.current,
    onSelect: () => { if (!company.current) switchCompany(company.id); },
  }));
  return [{ items: [...rows, ADD_COMPANY] }, { items: ITEMS }];
}

export function ProfileButton(props: { size?: number; placement?: 'right-end' | 'bottom-end' }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const profile = settings.value?.profile;
  const name = profile?.name || 'Profile';
  const canAdd = companies.value.length > 0;
  const phone = isAndroidApp() && hasNativePort(); // an older app without the port keeps the plain menu
  const current = phoneCompanies.value.find((company) => company.current);
  useEffect(loadCompanies, []);
  const head = phone ? (
    <div class="profile-head-row phone-head">
      <HumanAvatar size={40} />
      <div class="profile-head-text">
        <span class="profile-name">{name}</span>
        <button type="button" class="profile-status" onClick={() => { setOpen(false); showPcs(); }}>{statusLine(current?.name ?? companyLabel(profile, null), phoneStatus.value)}</button>
      </div>
    </div>
  ) : (
    <div class="profile-head-row">
      <button type="button" class="profile-head" onClick={() => { setOpen(false); go.settings(); }}>
        <span class="profile-name">{name}</span>
        {profile?.company && <span class="profile-company">{profile.company}</span>}
      </button>
      {canAdd && <IconButton icon="plus" label="Add a company" class="profile-add" onClick={() => { setOpen(false); setAdding(true); }} />}
    </div>
  );
  return (
    <>
      <button ref={ref} type="button" class="profile-button" data-tour="settings" aria-label="Profile menu" aria-haspopup="menu" aria-expanded={open} onClick={() => { if (!open) loadCompanies(); setOpen(!open); }}>
        <HumanAvatar size={props.size ?? 36} />
      </button>
      <Menu
        anchor={ref.current}
        open={open}
        onClose={() => setOpen(false)}
        placement={props.placement ?? 'right-end'}
        width={256}
        class="profile-menu"
        label="Profile"
        header={
          <>
            {head}
            {isMobile.value && <div class="profile-quota"><QuotaRail /></div>}
          </>
        }
        sections={phone ? phoneSections(phoneCompanies.value) : [...companySections(companies.value), { items: ITEMS }]}
      />
      <Menu anchor={ref.current} open={adding} onClose={() => setAdding(false)} placement={props.placement ?? 'right-end'} width={280} class="profile-menu" label="Add a company" sections={[{ items: ADD_ITEMS }]} />
    </>
  );
}
