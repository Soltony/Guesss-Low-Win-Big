import { describe, expect, it } from 'vitest';
import {
  expandTabPermissions,
  hasModuleAccess,
  hasPermission,
  readableTabs,
  sanitizePermissions,
} from './permissions';
import type { Permissions } from './types';

const user = (permissions: Permissions, role = 'Auction Manager') => ({ role, permissions });

/** A role saved before Content was split into tabs: the parent key only. */
const legacyRole: Permissions = {
  content: { read: true, create: true, update: true, delete: false },
};

describe('hasPermission', () => {
  it('reads an explicit tab grant', () => {
    const actor = user({ 'content.banners': { read: true, create: true } });
    expect(hasPermission(actor, 'content.banners', 'create')).toBe(true);
  });

  it('inherits the module grant when the tab was never saved', () => {
    expect(hasPermission(user(legacyRole), 'content.ads', 'update')).toBe(true);
    expect(hasPermission(user(legacyRole), 'content.ads', 'delete')).toBe(false);
  });

  it('lets an explicit tab grant override the module it sits under', () => {
    const actor = user({
      content: { read: true, create: true, update: true },
      'content.terms': { read: true, create: false, update: false },
    });
    expect(hasPermission(actor, 'content.terms', 'update')).toBe(false);
    expect(hasPermission(actor, 'content.banners', 'update')).toBe(true);
  });

  it('does not invent a parent for a module that has none', () => {
    expect(hasPermission(user({}), 'auctions', 'read')).toBe(false);
  });

  it('gives Super Admin every tab', () => {
    expect(hasPermission(user({}, 'Super Admin'), 'content.branding', 'delete')).toBe(true);
  });
});

describe('hasModuleAccess', () => {
  it('is true when only a tab carries the action', () => {
    const actor = user({ content: { read: true }, 'content.ads': { read: true, update: true } });
    expect(hasPermission(actor, 'content', 'update')).toBe(false);
    expect(hasModuleAccess(actor, 'content', 'update')).toBe(true);
  });

  it('is false when no tab carries it', () => {
    const actor = user({ content: { read: true }, 'content.ads': { read: true } });
    expect(hasModuleAccess(actor, 'content', 'delete')).toBe(false);
  });
});

describe('readableTabs', () => {
  it('returns only the tabs the role may open, in registry order', () => {
    // The shape the role builder saves: every tab spelled out, so nothing falls
    // back to the module.
    const actor = user({
      content: { read: true },
      'content.terms': { read: true, update: true },
      'content.banners': { read: true },
      'content.ads': { read: false },
      'content.participant-lists': { read: false },
      'content.branding': { read: false },
    });
    expect(readableTabs(actor, 'content').map((tab) => tab.tab)).toEqual(['banners', 'terms']);
  });

  it('carries the per-tab rights', () => {
    const actor = user({ content: { read: true }, 'content.banners': { read: true, delete: true } });
    const [banners] = readableTabs(actor, 'content');
    expect(banners).toMatchObject({ label: 'Banners', canCreate: false, canDelete: true });
  });

  it('gives a legacy role every tab of the module it was granted', () => {
    expect(readableTabs(user(legacyRole), 'content')).toHaveLength(5);
  });

  it('is empty for a module with no tabs', () => {
    expect(readableTabs(user({ auctions: { read: true } }), 'auctions')).toEqual([]);
  });
});

describe('expandTabPermissions', () => {
  it('materializes a legacy role so editing it cannot silently revoke tabs', () => {
    const expanded = expandTabPermissions(legacyRole);
    expect(expanded['content.participant-lists']).toEqual(legacyRole.content);
    // Still the same matrix once round-tripped through a save.
    const saved = sanitizePermissions(expanded);
    expect(hasPermission(user(saved), 'content.participant-lists', 'update')).toBe(true);
  });

  it('leaves an explicit tab grant alone', () => {
    const expanded = expandTabPermissions({
      content: { read: true, update: true },
      'content.ads': { read: true, update: false },
    });
    expect(expanded['content.ads']?.update).toBe(false);
  });

  it('adds nothing for a module the role does not have', () => {
    expect(expandTabPermissions({})['content.banners']).toBeUndefined();
  });
});

describe('sanitizePermissions', () => {
  it('keeps tab keys and drops unknown ones', () => {
    const clean = sanitizePermissions({
      'content.banners': { read: true },
      'content.nonsense': { read: true },
    } as Permissions);
    expect(clean['content.banners']?.read).toBe(true);
    expect(clean['content.nonsense']).toBeUndefined();
  });
});
