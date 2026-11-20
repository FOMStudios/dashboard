/* FOM Studios - reel and shoot ideas by genre, used on the Leads page when a business says
   "yes, send me ideas and a quote". Each idea: t (title), p (the pitch, {company} is filled in),
   get (what they receive), pkg (the package and price to quote). Edit freely: plain text, no long dashes.
   Packages: Mini Shoot R500 (30 min, 20 photos or 1 reel), Photography from R800 (2 hours),
   Videography from R1000, Photo and Video from R1500, Padel League weekly reels R2500 a week. */
window.FOM_IDEAS = {
  padel: { name: 'Padel clubs', match: /padel|racket|tennis|squash|pickle/i, ideas: [
    { t: 'Event night recap reel', p: 'A 30 to 45 second reel from one of your socials or tournaments: the warm-up, the best rallies in slow motion, players celebrating and the vibe after. Perfect to post the next day to fill the next event.', get: '1 edited reel (vertical, with music and captions) plus 10 photos', pkg: 'Videography from R1000' },
    { t: 'Weekly league reels', p: 'Every week we film your league or social night and deliver a short highlight reel, so your page always has fresh content and players tag themselves and their friends.', get: '1 reel every week, delivered within 48 hours', pkg: 'Padel League weekly reels, R2500 a week' },
    { t: '"Book a court" promo reel', p: 'A clean, cinematic 20 second reel of the courts, the lights at night and people playing, with your booking details at the end. Great for Instagram ads and your bio.', get: '1 promo reel in vertical and square', pkg: 'Mini Shoot R500 (30 minutes)' },
    { t: 'Coach and clinic content', p: 'Short tip videos with your coaches (a serve, a smash, a common mistake) that you can post weekly to grow your page and sell clinics.', get: '3 to 4 short tip reels from one session', pkg: 'Videography from R1000' } ] },
  running: { name: 'Running and cycling clubs', match: /run|cycl|ride|marathon|triathlon|parkrun|trail/i, ideas: [
    { t: 'Sunrise run reel', p: 'We join one of your runs and film the start, the city or trail views, the pack moving and the coffee after. A reel that shows new people exactly what it feels like to run with {company}.', get: '1 reel plus 20 photos runners can tag themselves in', pkg: 'Photo and Video from R1500' },
    { t: 'Find yourself photo set', p: 'A big set of action photos from one run that you share in your group and on Instagram, so every runner finds and tags themselves. Great for growing the club.', get: '50 or more edited action photos', pkg: 'Photography from R800 (2 hours)' },
    { t: 'Race day recap', p: 'Coverage of your club at a race or time trial: the nerves, the finish and the medals, cut into a short recap reel.', get: '1 recap reel plus photos', pkg: 'Photo and Video from R1500' } ] },
  sports: { name: 'Sports clubs and events', match: /club|league|tournament|gym|fitness|crossfit|boxing|golf|soccer|rugby|cricket|sport/i, ideas: [
    { t: 'Match or event highlight reel', p: 'A short, high-energy highlight reel from one of your games or events that you can post straight away to build hype for the next one.', get: '1 highlight reel plus 15 photos', pkg: 'Photo and Video from R1500' },
    { t: 'Meet the team series', p: 'Short player or coach intro clips you can post weekly. People follow people, so this grows your page fast.', get: '4 short intro reels', pkg: 'Videography from R1000' },
    { t: 'Facility promo', p: 'A clean promo reel of your space, training and members, for your bio, website and ads.', get: '1 promo reel', pkg: 'Mini Shoot R500 (30 minutes)' } ] },
  food: { name: 'Restaurants, cafes and bakeries', match: /restaurant|cafe|café|coffee|bakery|bread|pizza|sushi|pasta|food|kitchen|bistro|grill|dessert|waffle|chocolate|tea/i, ideas: [
    { t: 'Signature dish reel', p: 'A mouth-watering 15 to 20 second reel of your best dish being made and served: the sizzle, the pour, the first bite. The kind of reel people send to a friend with "we have to go here".', get: '1 reel plus 10 food photos for your menu and socials', pkg: 'Mini Shoot R500 (30 minutes)' },
    { t: 'Menu and space photo set', p: 'A full set of clean, bright photos of your menu favourites and the space, for your menu, Google listing, delivery apps and Instagram.', get: '20 to 30 edited photos', pkg: 'Photography from R800 (2 hours)' },
    { t: 'Behind the scenes with the chef', p: 'A short story-style reel of your team prepping and plating, showing the people behind {company}. Builds trust and gets people through the door.', get: '1 reel plus photos', pkg: 'Photo and Video from R1500' } ] },
  venue: { name: 'Function venues and events', match: /venue|function|event|wedding venue|hotel|rooftop|conference|party|lounge|bar|club night|jazz/i, ideas: [
    { t: 'Event night reel', p: 'We film one of your functions or events: the setup, the guests arriving, the food, the dance floor. A reel you can use to sell the venue for the next season.', get: '1 reel plus 20 photos', pkg: 'Photo and Video from R1500' },
    { t: 'Venue walkthrough', p: 'A smooth walkthrough reel of the space set up for an event, so clients can picture their function at {company} before they visit.', get: '1 walkthrough reel plus 15 photos of the space', pkg: 'Photo and Video from R1500' },
    { t: 'Preferred supplier for your clients', p: 'We can be the photo and video team you recommend to people booking functions with you, so your clients get great content and you get a steady flow of event content too.', get: 'Event coverage for your clients, content for you', pkg: 'Photo and Video from R1500 per event' } ] },
  auto: { name: 'Dealers, detailers and wrap shops', match: /car|auto|motor|detail|wrap|ppf|ceramic|tint|dealer|vehicle|garage|kustom|custom/i, ideas: [
    { t: 'Before and after reel', p: 'A satisfying reel of one job from start to finish: the dirty or stock car, the work in progress and the reveal with a beat drop. These do really well on Instagram and TikTok.', get: '1 reel plus 10 photos of the finished car', pkg: 'Mini Shoot R500 (30 minutes)' },
    { t: 'Cinematic car feature', p: 'A short cinematic feature of a car on the road or in a great location, rolling shots and details, for your page or a client handover.', get: '1 cinematic reel plus 15 photos', pkg: 'Photo and Video from R1500' },
    { t: 'New stock walkarounds', p: 'Quick 30 second walkaround videos of new stock, so buyers can see the car before they visit. Great for your socials and listings.', get: '3 walkaround reels', pkg: 'Videography from R1000' } ] },
  corporate: { name: 'Companies and brands', match: /corporate|company|office|brand|agency|launch|product|team/i, ideas: [
    { t: 'Year-end function coverage', p: 'Photos and a short reel of your year-end function that your team will actually share on LinkedIn and Instagram.', get: '1 reel plus 40 photos', pkg: 'Photo and Video from R1500' },
    { t: 'Team and headshot day', p: 'Clean, consistent headshots and a few team shots for your website and LinkedIn.', get: 'Edited headshots for each person', pkg: 'Photography from R800 (2 hours)' },
    { t: 'Product or launch reel', p: 'A short, punchy reel for your product or launch, ready for socials and ads.', get: '1 reel in vertical and square', pkg: 'Videography from R1000' } ] },
  wedding: { name: 'Wedding venues and couples', match: /wedding|bridal|bride|engage|couple/i, ideas: [
    { t: 'Styled venue shoot', p: 'A styled shoot at {company} with a couple, decor and golden-hour light, giving you fresh photos and a reel to sell your dates.', get: '30 photos plus 1 reel', pkg: 'Photo and Video from R1500' },
    { t: 'Wedding highlight reel', p: 'A short, emotional highlight reel of a wedding day that couples love to share and that shows off the venue.', get: '1 highlight reel', pkg: 'Videography from R1000' } ] },
  general: { name: 'Any business', match: /./, ideas: [
    { t: 'Short promo reel', p: 'A short, engaging reel about {company} that you can post and pin, showing what you do and why people should come to you.', get: '1 reel plus 10 photos', pkg: 'Mini Shoot R500 (30 minutes)' },
    { t: 'Fresh photo set', p: 'A set of clean, on-brand photos for your website, Google listing and socials.', get: '20 to 30 edited photos', pkg: 'Photography from R800 (2 hours)' },
    { t: 'Monthly content day', p: 'One shoot a month that gives you a month of reels and photos, so your page never goes quiet.', get: '4 reels plus 20 photos a month', pkg: 'Photo and Video from R1500 a month' } ] }
};
/* which genres fit a lead: best match first, always ending with "Any business" */
window.FOM_IDEAS_FOR = function(o){
  var txt = [o.company, o.category, o.why, o.opener, o.comments, o.web, o.instagram].join(' ');
  var order = ['padel', 'running', 'food', 'auto', 'wedding', 'venue', 'corporate', 'sports'], out = [];
  var cat = String(o.category || '');
  if(/Automotive/.test(cat)) out.push('auto');
  if(/Wedding/.test(cat)) out.push('wedding');
  if(/Corporate/.test(cat)) out.push('corporate');
  order.forEach(function(k){ if(out.indexOf(k) < 0 && FOM_IDEAS[k].match.test(txt)) out.push(k); });
  if(/Sports/.test(cat) && out.indexOf('sports') < 0) out.push('sports');
  if(/Catering/.test(cat) && out.indexOf('venue') < 0 && out.indexOf('food') < 0) out.push('venue');
  out.push('general');
  return out.slice(0, 3);
};
