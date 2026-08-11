// Каталог коктейлей. Все объёмы в мл.
// color/opacity — как жидкость выглядит в стакане;
// vessel описывает сосуд, из которого наливают.

export const COCKTAILS = [
  {
    id: 'screwdriver',
    name: 'Отвёртка',
    tagline: 'Водка · апельсиновый сок',
    glass: 'highball',
    swatch: 'linear-gradient(160deg, #ffc25e, #f08c1b)',
    // Пре-рендеренные кадры отключены: все коктейли идут в realtime-режиме
    // (как Негрони). Вернуть: frames: { base: '/frames/screwdriver/', count: 240 },
    ingredients: [
      {
        name: 'Водка',
        amount: 50,
        color: 0xeef1f6, opacity: 0.16,
        vessel: {
          shape: 'spirit', tint: 0xeef4f9, glassOpacity: 0.2, label: 'ВОДКА',
          labelBg: '#e9eef3', labelFg: '#20303f', capColor: 0x8f9aa6,
        },
      },
      {
        name: 'Апельсиновый сок',
        amount: 150,
        color: 0xf59a12, opacity: 0.96,
        vessel: {
          shape: 'carafe', tint: 0xf59a12, label: 'СОК',
          labelBg: '#f7a01e', labelFg: '#3d2503', capColor: 0x3d2503,
          liquid: 0xf59a12,
        },
      },
    ],
  },
  {
    id: 'gin-tonic',
    name: 'Джин-тоник',
    tagline: 'Джин · тоник',
    glass: 'highball',
    swatch: 'linear-gradient(160deg, #dfeef0, #9fc6c9)',
    ingredients: [
      {
        name: 'Джин',
        amount: 50,
        color: 0xe8f2ee, opacity: 0.16,
        vessel: {
          shape: 'spirit', tint: 0x4d7a5d, label: 'ДЖИН',
          labelBg: '#17352a', labelFg: '#e8d9ae', capColor: 0x1d2b24,
        },
      },
      {
        name: 'Тоник',
        amount: 150,
        color: 0xdfeef0, opacity: 0.2,
        vessel: {
          shape: 'soda', tint: 0xd9e8b8, glassOpacity: 0.32, label: 'ТОНИК',
          labelBg: '#f2efdc', labelFg: '#3a4a20', capColor: 0xc9c23a,
        },
      },
    ],
  },
  {
    id: 'cuba-libre',
    name: 'Куба Либре',
    tagline: 'Ром · кола · сок лайма',
    glass: 'highball',
    swatch: 'linear-gradient(160deg, #7a4526, #2a1207)',
    ingredients: [
      {
        name: 'Золотой ром',
        amount: 50,
        color: 0xc98a35, opacity: 0.55,
        vessel: {
          shape: 'spirit', tint: 0xa06a28, label: 'РОМ',
          labelBg: '#2e1c0d', labelFg: '#e6c07a', capColor: 0x24160a,
        },
      },
      {
        name: 'Кола',
        amount: 120,
        color: 0x2f1408, opacity: 0.93,
        vessel: {
          shape: 'soda', tint: 0x2f1408, label: 'КОЛА',
          labelBg: '#b01e23', labelFg: '#f7f1e3', capColor: 0xb01e23,
          liquid: 0x2f1408,
        },
      },
      {
        name: 'Сок лайма',
        amount: 10,
        color: 0xc3de74, opacity: 0.5,
        vessel: {
          shape: 'carafe', tint: 0xc3de74, label: 'ЛАЙМ',
          labelBg: '#c8e07e', labelFg: '#2c3d10', capColor: 0x2c3d10,
          liquid: 0xc3de74,
        },
      },
    ],
  },
  {
    id: 'negroni',
    name: 'Негрони',
    tagline: 'Джин · вермут · кампари',
    glass: 'rocks',
    swatch: 'linear-gradient(160deg, #e0393f, #7c1626)',
    ingredients: [
      {
        name: 'Джин',
        amount: 30,
        color: 0xe8f2ee, opacity: 0.16,
        vessel: {
          shape: 'spirit', tint: 0x4d7a5d, label: 'ДЖИН',
          labelBg: '#17352a', labelFg: '#e8d9ae', capColor: 0x1d2b24,
        },
      },
      {
        name: 'Красный вермут',
        amount: 30,
        color: 0x7c2330, opacity: 0.85,
        vessel: {
          shape: 'spirit', tint: 0x5c1a24, label: 'ВЕРМУТ',
          labelBg: '#3a1016', labelFg: '#e3b98a', capColor: 0x2b0b10,
        },
      },
      {
        name: 'Кампари',
        amount: 30,
        color: 0xd11a3c, opacity: 0.9,
        vessel: {
          shape: 'spirit', tint: 0xb5122f, label: 'КАМПАРИ',
          labelBg: '#c8102e', labelFg: '#fdf3e3', capColor: 0x1a1a1a,
        },
      },
    ],
  },
];
