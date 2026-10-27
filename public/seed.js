export function createBook() {
  const categories = [
    { id: 'food', name: '餐饮', icon: 'cup', kind: 'expense', children: [{ id: 'meal', name: '日常三餐' }, { id: 'coffee', name: '咖啡茶饮' }, { id: 'snack', name: '零食水果' }] },
    { id: 'transport', name: '出行', icon: 'train', kind: 'expense', children: [{ id: 'metro', name: '公共交通' }, { id: 'taxi', name: '打车' }, { id: 'ticket', name: '机票车票' }] },
    { id: 'shopping', name: '购物', icon: 'bag', kind: 'expense', children: [{ id: 'daily', name: '生活用品' }, { id: 'clothes', name: '衣物鞋包' }, { id: 'digital', name: '数码家电' }] },
    { id: 'life', name: '生活', icon: 'home', kind: 'expense', children: [{ id: 'rent', name: '住房' }, { id: 'service', name: '订阅服务' }, { id: 'health', name: '医疗健康' }] },
    { id: 'leisure', name: '休闲', icon: 'sun', kind: 'expense', children: [{ id: 'movie', name: '电影演出' }, { id: 'hotel', name: '旅行住宿' }, { id: 'book', name: '书籍阅读' }] },
    { id: 'earning', name: '收入', icon: 'income', kind: 'income', children: [{ id: 'salary', name: '工资' }, { id: 'interest', name: '利息' }, { id: 'other', name: '其他收入' }] },
  ];
  const accounts = [
    { id: 'cmb', name: '招商银行', subtitle: '日常储蓄 · 6228', type: 'bank', currency: 'CNY', openingMinor: '2864200', color: 'rose', mark: '招' },
    { id: 'alipay', name: '支付宝', subtitle: '日常支付', type: 'wallet', currency: 'CNY', openingMinor: '268850', color: 'blue', mark: '支' },
    { id: 'wechat', name: '微信钱包', subtitle: '零钱', type: 'wallet', currency: 'CNY', openingMinor: '82600', color: 'green', mark: '微' },
    { id: 'cash', name: '现金', subtitle: '随身钱包', type: 'cash', currency: 'CNY', openingMinor: '50000', color: 'sand', mark: 'cash' },
    { id: 'credit', name: '招商信用卡', subtitle: '人民币 · 8606', type: 'credit', currency: 'CNY', openingMinor: '-186000', color: 'purple', mark: 'card' },
    { id: 'usd', name: '美元信用卡', subtitle: '美元 · 1008', type: 'credit', currency: 'USD', openingMinor: '-12840', color: 'slate', mark: 'card' },
  ];
  const rows = [
    ['cmb', 'expense', 'Manner 咖啡', '1800', 'coffee', 0, 9, 12],
    ['alipay', 'expense', '地铁通勤', '600', 'metro', 0, 8, 35],
    ['cmb', 'expense', '全家便利店', '2450', 'meal', 1, 19, 42],
    ['wechat', 'expense', '午间简餐', '3200', 'meal', 1, 12, 18],
    ['credit', 'expense', '山姆会员店', '36800', 'daily', 2, 16, 24],
    ['alipay', 'expense', '瑞幸咖啡', '990', 'coffee', 2, 10, 16],
    ['cmb', 'expense', '周末晚餐', '18600', 'meal', 3, 18, 30],
    ['wechat', 'expense', '滴滴出行', '2860', 'taxi', 3, 15, 47],
    ['credit', 'expense', 'MUJI 生活用品', '12900', 'daily', 4, 14, 20],
    ['cmb', 'income', '工资', '1850000', 'salary', 5, 10, 0],
    ['alipay', 'expense', '街角咖啡', '2600', 'coffee', 5, 9, 30],
    ['cmb', 'expense', '一杯咖啡', '2200', 'coffee', 6, 11, 20],
    ['cash', 'expense', '早餐', '1200', 'meal', 6, 8, 10],
    ['credit', 'expense', '书店', '6800', 'book', 7, 15, 0],
    ['usd', 'expense', 'iCloud+', '299', 'service', 8, 11, 0],
  ];
  const entries = rows.map((r, index) => {
    const date = new Date(); date.setDate(date.getDate() - r[5]); date.setHours(r[6], r[7], 0, 0);
    return { id: `sample-${index}`, accountId: r[0], kind: r[1], description: r[2], amountMinor: r[3], categoryId: r[4], occurredAt: date.toISOString(), createdAt: date.toISOString(), project: '', note: '', revision: 1 };
  });
  return { schema: 1, id: 'fine-ledger-p0-synthetic', accounts, categories, entries, projects: ['秋日杭州', '京都旅行'], createdAt: new Date().toISOString() };
}
