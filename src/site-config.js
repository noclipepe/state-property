// Public release settings for the STATE PROPERTY series. Edit this one object: the games in the
// menu, creator links, the public URL used for share metadata, and analytics.
// The build (tools/build.mjs) reads it too: it publishes every available game's page and writes
// the share metadata.
export const SITE = {
  title: 'STATE PROPERTY',
  subtitle: 'Choose your POV',
  studio: 'noclipepe games',
  handle: '@noclipepe',
  description: 'Five perspectives on the State Property meme: fisherman, driver, fish, ant, and divine intervention. Free browser games by @noclipepe.',

  // The address the site is published at (e.g. 'https://state-property.pages.dev/'), for the
  // og:url / og:image tags. Leave empty until it is known: the build then writes relative previews.
  siteUrl: 'https://state-property.pages.dev/',

  links: {
    instagram: 'https://www.instagram.com/noclipepe/', // primary destination
    tiktok: 'https://www.tiktok.com/@noclipepe',
    x: 'https://x.com/noclipepe',
    reel: 'https://www.instagram.com/reel/DeP2NfbMGPl/', // the driver POV reel
  },

  // The series menu (index.html), in this order. To add a game later, add an entry:
  //   id         unique, lowercase
  //   title      shown on the card
  //   isNew      true highlights the card and shows a small NEW badge above the title
  //   tagline    a few words under the title
  //   image      card screenshot, 16:10 (assets/brand/card-<id>.jpg; tools/capture-previews.mjs makes them)
  //   available  false shows the card greyed out with "Not available yet" and no PLAY button
  //   teaser     true (with available: false): a "COMING SOON" announcement card with a
  //              "Get notified" button to Instagram instead of the greyed-out look. When the game
  //              is ready, give it a real title, image and launch, and set available: true.
  //   launch     { page: 'x.html' } a game page in this project (the build publishes it), or
  //              { url: 'https://…' } a game hosted elsewhere
  games: [
    { id: 'fisherman', title: 'FISHERMAN POV', tagline: 'You hold the rod', image: 'assets/brand/card-fisherman.jpg', available: true, launch: { page: 'fisherman.html' } },
    { id: 'driver', title: 'DRIVER POV', tagline: 'You drive the pickup', image: 'assets/brand/card-driver.jpg', available: true, launch: { page: 'driver.html' } },
    { id: 'fish', title: 'FISH POV', tagline: "You're already caught.", image: 'assets/brand/card-fish.jpg', available: true, launch: { page: 'fish.html' } },
    { id: 'ant', title: 'ANT POV', tagline: 'Just trying to get home.', image: 'assets/brand/card-ant.jpg', available: true, launch: { page: 'ant.html' } },
    { id: 'god', title: 'GOD POV', tagline: 'Divine intervention.', image: 'assets/brand/card-god.jpg', isNew: true, available: true, launch: { page: 'god.html' } },
  ],

  // Analytics adapter, off by default (no events are collected). See README > Analytics.
  // provider: null | 'plausible' | 'umami' | 'gtag' | 'custom'
  // For 'custom', set window.noclipepeTrack = (name, props) => { … } before the game loads.
  analytics: { provider: null },
};
