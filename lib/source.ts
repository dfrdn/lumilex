/**
 * Where the source code of this running instance is offered.
 *
 * Lumilex is AGPL-3.0. Its section 13 asks that anyone who runs a modified
 * version for other people over a network offer those people its source, so
 * every surface a person signs in to links here: the sign-in pages, the staff
 * sidebars and the client portal's footer. An operator running a modified
 * copy sets NEXT_PUBLIC_SOURCE_URL to their own repository; an unmodified
 * instance points at the upstream one. It is an address, like APP_BASE_URL,
 * not a switch.
 */
export const UPSTREAM_SOURCE_URL = 'https://github.com/dfrdn/lumilex';

export const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_URL || UPSTREAM_SOURCE_URL;
