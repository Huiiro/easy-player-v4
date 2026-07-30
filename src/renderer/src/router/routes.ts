export const constRoutes = [
  {
    path: '/',
    redirect: '/home'
  },
  {
    path: '/',
    name: 'layout',
    component: () => import('@/views/layout/Index.vue'),
    children: [
      ...(import.meta.env.DEV
        ? [
            {
              path: '/dev',
              name: 'Dev',
              meta: { title: 'DEV' },
              component: () => import('@/views/dev/Index.vue')
            }
          ]
        : []),
      {
        path: '/song',
        name: 'Song',
        meta: { title: '歌曲' },
        component: () => import('@/views/song/Index.vue')
      },
      {
        path: '/album',
        name: 'Album',
        meta: { title: '专辑' },
        component: () => import('@/views/album/Index.vue')
      },
      {
        path: '/album/detail',
        name: 'AlbumDetail',
        meta: { title: '专辑详情', keepAlive: false },
        component: () => import('@/views/album/AlbumDetail.vue')
      },
      {
        path: '/artist',
        name: 'Artist',
        meta: { title: '歌手' },
        component: () => import('@/views/artist/Index.vue')
      },
      {
        path: '/artist/detail',
        name: 'ArtistDetail',
        meta: { title: '歌手详情', keepAlive: false },
        component: () => import('@/views/artist/ArtistDetail.vue')
      },
      {
        path: '/genre',
        name: 'Genre',
        meta: { title: '流派' },
        component: () => import('@/views/genre/Index.vue')
      },
      {
        path: '/genre/detail',
        name: 'GenreDetail',
        meta: { title: '流派详情', keepAlive: false },
        component: () => import('@/views/genre/GenreDetail.vue')
      },
      {
        path: '/local',
        name: 'Local',
        meta: { title: '本地文件' },
        component: () => import('@/views/local/Index.vue')
      },
      {
        path: '/remote',
        name: 'Remote',
        meta: { title: '远程文件' },
        component: () => import('@/views/remote/Index.vue')
      },
      {
        path: '/history',
        name: 'History',
        meta: { title: '播放历史' },
        component: () => import('@/views/history/Index.vue')
      },
      {
        path: '/home',
        name: 'Home',
        meta: { title: '主页' },
        component: () => import('@/views/home/Index.vue')
      },
      {
        path: '/settings',
        name: 'Settings',
        meta: { title: '设置' },
        component: () => import('@/views/settings/Index.vue')
      },
      {
        path: '/download',
        name: 'Download',
        meta: { title: '下载中心' },
        component: () => import('@/views/download/Index.vue')
      },
      {
        path: '/playlist/:id',
        name: 'Playlist',
        meta: { title: '歌单详情', keepAlive: false },
        component: () => import('@/views/playlist/Index.vue')
      }
    ]
  },
  {
    path: '/lyric',
    name: 'Lyric',
    meta: { title: '桌面歌词' },
    component: () => import('@/views/lyrics/desktop/Index.vue')
  },
  {
    path: '/mini',
    name: 'MiniPlayer',
    meta: { title: '迷你播放器' },
    component: () => import('@/views/player/mini/Index.vue')
  }
]
