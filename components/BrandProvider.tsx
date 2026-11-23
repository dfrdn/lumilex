'use client';

import { createContext, useContext } from 'react';
import { NEUTRAL_WEB_BRAND, type WebBrand } from '@/lib/firm/brand-shape';

/**
 * The firm identity for the current request, resolved once server-side in the
 * root layout and read by every client shell.
 *
 * Context rather than props: the five role shells mount from ~120 page files,
 * and a brand prop threaded through all of them is a prop that one new page will
 * forget to pass — at which point that page renders the wrong firm's mark, which
 * is exactly the failure this phase exists to close.
 *
 * The default is the neutral platform brand, never a firm: a client component
 * rendered outside the provider shows "Lumilex", not somebody's letterhead.
 */
const BrandContext = createContext<WebBrand>(NEUTRAL_WEB_BRAND);

export function BrandProvider({
  brand,
  children,
}: {
  brand: WebBrand;
  children: React.ReactNode;
}) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): WebBrand {
  return useContext(BrandContext);
}
