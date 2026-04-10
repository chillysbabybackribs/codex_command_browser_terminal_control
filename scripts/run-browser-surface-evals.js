const { resolveBrowserSurface } = require('../dist/main/shared/browser/surfaceResolver.js');

const fixtures = [
  {
    name: 'tiktok-home-feed',
    evidence: {
      url: 'https://www.tiktok.com/foryou?lang=en',
      pathname: '/foryou',
      title: 'TikTok',
      mainHeading: 'For You',
      visibleTextExcerpt: 'For You Following Explore LIVE Messages Activity Profile',
      expandedTriggerLabels: [],
      panelCandidates: [],
      hasFeedMarkers: true,
      hasMessagesMarkers: true,
      hasNotificationsMarkers: false,
      hasActivityMarkers: true,
      hasVisibleForm: false,
    },
    expected: {
      activeSurfaceType: 'feed',
      isPrimarySurface: true,
    },
  },
  {
    name: 'tiktok-activity-panel',
    evidence: {
      url: 'https://www.tiktok.com/foryou?lang=en',
      pathname: '/foryou',
      title: 'TikTok',
      mainHeading: 'For You',
      visibleTextExcerpt: 'For You Following Messages Activity All activity Likes Comments Followers',
      expandedTriggerLabels: ['Activity'],
      panelCandidates: [
        {
          selector: 'div#header-inbox-list',
          label: 'All activity Likes Comments Followers',
          area: 42000,
          position: 'absolute',
          fromExpandedTrigger: true,
        },
      ],
      hasFeedMarkers: true,
      hasMessagesMarkers: false,
      hasNotificationsMarkers: false,
      hasActivityMarkers: true,
      hasVisibleForm: false,
    },
    expected: {
      foregroundUiType: 'panel',
      activeSurfaceType: 'panel',
      isPrimarySurface: false,
    },
  },
  {
    name: 'github-issue-page',
    evidence: {
      url: 'https://github.com/openai/openai/issues/123',
      pathname: '/openai/openai/issues/123',
      title: 'Bug report · Issue #123 · openai/openai',
      mainHeading: 'Bug report',
      visibleTextExcerpt: 'Bug report Open issue Assignees Labels Projects',
      expandedTriggerLabels: [],
      panelCandidates: [],
      hasFeedMarkers: false,
      hasMessagesMarkers: false,
      hasNotificationsMarkers: false,
      hasActivityMarkers: false,
      hasVisibleForm: true,
    },
    expected: {
      activeSurfaceType: 'form',
      isPrimarySurface: false,
    },
  },
  {
    name: 'generic-login-form',
    evidence: {
      url: 'https://example.com/login',
      pathname: '/login',
      title: 'Sign in',
      mainHeading: 'Sign in',
      visibleTextExcerpt: 'Sign in Email Password Continue Forgot password',
      expandedTriggerLabels: [],
      panelCandidates: [],
      hasFeedMarkers: false,
      hasMessagesMarkers: false,
      hasNotificationsMarkers: false,
      hasActivityMarkers: false,
      hasVisibleForm: true,
    },
    expected: {
      activeSurfaceType: 'form',
      isPrimarySurface: false,
    },
  },
  {
    name: 'slack-channel-sidebar-panel',
    evidence: {
      url: 'https://app.slack.com/client/T123/C456',
      pathname: '/client/T123/C456',
      title: 'engineering | Slack',
      mainHeading: 'engineering',
      visibleTextExcerpt: 'engineering Threads Activity Later More message input',
      expandedTriggerLabels: ['Activity'],
      panelCandidates: [
        {
          selector: 'div[data-qa="activity_panel"]',
          label: 'Activity mentions reactions threads',
          area: 36000,
          position: 'absolute',
          fromExpandedTrigger: true,
        },
      ],
      hasFeedMarkers: false,
      hasMessagesMarkers: true,
      hasNotificationsMarkers: false,
      hasActivityMarkers: true,
      hasVisibleForm: true,
    },
    expected: {
      foregroundUiType: 'panel',
      activeSurfaceType: 'panel',
      isPrimarySurface: false,
    },
  },
  {
    name: 'youtube-home-feed',
    evidence: {
      url: 'https://www.youtube.com/',
      pathname: '/',
      title: 'YouTube',
      mainHeading: '',
      visibleTextExcerpt: 'Home Shorts Subscriptions You History Sign in',
      expandedTriggerLabels: [],
      panelCandidates: [],
      hasFeedMarkers: true,
      hasMessagesMarkers: false,
      hasNotificationsMarkers: false,
      hasActivityMarkers: false,
      hasVisibleForm: true,
      strategy: {
        primaryRoutes: ['/'],
        primaryLabels: ['Home', 'Shorts', 'Subscriptions', 'You', 'History'],
        panelKeywords: ['guide', 'mini player', 'queue', 'comments', 'notifications', 'more actions'],
      },
    },
    expected: {
      activeSurfaceType: 'feed',
      activeSurfaceLabel: 'Home',
      isPrimarySurface: true,
    },
  },
];

let failed = 0;
for (const fixture of fixtures) {
  const result = resolveBrowserSurface(fixture.evidence);
  const checks = [
    fixture.expected.foregroundUiType === undefined || result.foregroundUi.type === fixture.expected.foregroundUiType,
    fixture.expected.activeSurfaceType === undefined || result.activeSurface.type === fixture.expected.activeSurfaceType,
    fixture.expected.activeSurfaceLabel === undefined || result.activeSurface.label === fixture.expected.activeSurfaceLabel,
    fixture.expected.isPrimarySurface === undefined || result.activeSurface.isPrimarySurface === fixture.expected.isPrimarySurface,
  ];
  const ok = checks.every(Boolean);
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${fixture.name}`);
    console.error(JSON.stringify({ expected: fixture.expected, actual: result }, null, 2));
  } else {
    console.log(`PASS ${fixture.name}`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}
