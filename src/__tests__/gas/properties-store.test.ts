import { describe, expect, it, vi } from 'vitest';
import { createPropertiesStore, ROLE_ASSIGNMENTS_PROPERTY_KEY } from '../../gas/properties-store.js';

function fakeProperties(value: string | null): GoogleAppsScript.Properties.Properties {
  return {
    getProperty: vi.fn().mockReturnValue(value),
  } as unknown as GoogleAppsScript.Properties.Properties;
}

describe('createPropertiesStore', () => {
  it('reads roles for an assigned email from the JSON blob', () => {
    const properties = fakeProperties(JSON.stringify({ 'alice@org.com': ['admin'] }));
    const store = createPropertiesStore(properties);
    expect(store.getRoles('alice@org.com')).toEqual(['admin']);
  });

  it('returns an empty array for an email with no entry', () => {
    const properties = fakeProperties(JSON.stringify({ 'alice@org.com': ['admin'] }));
    const store = createPropertiesStore(properties);
    expect(store.getRoles('nobody@org.com')).toEqual([]);
  });

  it('returns an empty array when the property is unset', () => {
    const properties = fakeProperties(null);
    const store = createPropertiesStore(properties);
    expect(store.getRoles('alice@org.com')).toEqual([]);
  });

  it('degrades to empty rather than throwing when the property is not valid JSON', () => {
    const properties = fakeProperties('not json');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createPropertiesStore(properties);
    expect(store.getRoles('alice@org.com')).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(ROLE_ASSIGNMENTS_PROPERTY_KEY));
    errorSpy.mockRestore();
  });

  it('reads from the documented property key', () => {
    const properties = fakeProperties(null);
    createPropertiesStore(properties).getRoles('alice@org.com');
    expect(properties.getProperty).toHaveBeenCalledWith(ROLE_ASSIGNMENTS_PROPERTY_KEY);
  });
});
