import { create } from 'zustand';
import { MOCK_PRODUCTS, type AdminProduct } from '@/lib/mockData';

interface ProductState {
  products: AdminProduct[];
  addProduct: (product: Omit<AdminProduct, 'id'>) => void;
  updateProduct: (id: string, updates: Partial<AdminProduct>) => void;
  /** Soft delete only — mirrors the architecture decision to never hard-delete
   *  products, since existing orders reference them by id (order_items keeps
   *  its own name/price snapshot, but the product row itself must persist). */
  deactivateProduct: (id: string) => void;
  reactivateProduct: (id: string) => void;
}

export const useProductStore = create<ProductState>((set) => ({
  products: MOCK_PRODUCTS,

  addProduct: (product) => {
    set((state) => ({
      products: [...state.products, { ...product, id: `p_${Date.now()}` }],
    }));
  },

  updateProduct: (id, updates) => {
    set((state) => ({
      products: state.products.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  },

  deactivateProduct: (id) => {
    set((state) => ({
      products: state.products.map((p) => (p.id === id ? { ...p, isActive: false } : p)),
    }));
  },

  reactivateProduct: (id) => {
    set((state) => ({
      products: state.products.map((p) => (p.id === id ? { ...p, isActive: true } : p)),
    }));
  },
}));
