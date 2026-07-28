import 'server-only';
import type { StoreRecord } from './types';

/**
 * Initial store registry.
 *
 * The coordinates are real Bangalore locations so the nearby-store ordering can be
 * checked against something a person recognises rather than against invented numbers.
 * These replace the hardcoded `distanceKm` values that used to sit in
 * `src/lib/mockData.ts`, which were fixed constants and therefore wrong for every
 * customer who was not standing at the notional origin.
 *
 * The egress CIDRs are RFC 5737 documentation addresses. They are placeholders and every
 * one of them must be replaced with the store's real customer-Wi-Fi NAT gateway IP before
 * a pilot, or shoppers at that store are refused with `presence_not_verified`.
 */
export const STORE_SEED: StoreRecord[] = [
  {
    id: 'store_1',
    name: 'DMart Supercenter',
    address: 'HSR Layout, Sector 6, Bangalore',
    latitude: 12.9082,
    longitude: 77.6476,
    authorizedEgressCidrs: ['198.51.100.24/32'],
    advertisedSsid: 'DMart-Guest',
    isActive: true,
    isOpen: true,
  },
  {
    id: 'store_2',
    name: 'SnapUp Express',
    address: 'Koramangala 5th Block, Bangalore',
    latitude: 12.9345,
    longitude: 77.6142,
    authorizedEgressCidrs: ['198.51.100.25/32', '203.0.113.0/28'],
    advertisedSsid: 'SnapUp-Guest',
    isActive: true,
    isOpen: true,
  },
  {
    id: 'store_3',
    name: 'FreshMart Central',
    address: 'Indiranagar 100ft Road, Bangalore',
    latitude: 12.9719,
    longitude: 77.6412,
    authorizedEgressCidrs: ['203.0.113.64/28'],
    advertisedSsid: 'FreshMart-WiFi',
    isActive: true,
    isOpen: false,
  },
  {
    id: 'store_4',
    name: 'DMart Ready',
    address: 'BTM Layout, Bangalore',
    latitude: 12.9166,
    longitude: 77.6101,
    authorizedEgressCidrs: ['198.51.100.40/32'],
    advertisedSsid: 'DMart-Guest',
    isActive: true,
    isOpen: true,
  },
  {
    id: 'store_5',
    name: 'SnapUp Express',
    address: 'Jayanagar 4th Block, Bangalore',
    latitude: 12.925,
    longitude: 77.5838,
    authorizedEgressCidrs: ['198.51.100.41/32'],
    advertisedSsid: 'SnapUp-Guest',
    isActive: true,
    isOpen: true,
  },
];
