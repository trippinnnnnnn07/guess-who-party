// Original fictional characters for local smoke testing, not community submissions.
export const demoBank = {
  categories: [{ id: 'demo', name: 'สาธิต · ตัวละครสมมติ' }],
  async pick(settings) {
    if (settings.categoryIds.length && !settings.categoryIds.includes('demo'))
      return []
    const groups = [
      [
        'พลังไฟ',
        'น้ำแข็ง',
        ['อัคคี', 'ประกาย', 'คบเพลิง', 'เหมันต์'],
        ['fire', 'fire', 'fire', 'ice'],
      ],
      [
        'พลังน้ำแข็ง',
        'พลังดิน',
        ['เกล็ดหิมะ', 'เหมันต์', 'ธารเย็น', 'ภูผา'],
        ['ice', 'ice', 'ice', 'earth'],
      ],
      [
        'พลังดิน',
        'พลังไฟ',
        ['ภูผา', 'ศิลา', 'ปฐพี', 'อัคคี'],
        ['earth', 'earth', 'earth', 'fire'],
      ],
    ]
    return groups
      .slice(0, settings.questionCount)
      .map(([hint, other, names, elements], index) => ({
        id: `demo-${index}`,
        title: 'ใครต่างจากเพื่อน?',
        category_id: 'demo',
        author_id: null,
        hint,
        explanation: `${names[3]} ใช้${other} ส่วนอีกสามคนใช้${hint} (ตัวละครสมมติสำหรับทดลองระบบ)`,
        correct_index: 3,
        options: names.map((name, i) => ({
          name,
          source: 'ผู้พิทักษ์ธาตุ · เรื่องสมมติ',
          imageUrl: `/quiz-samples/${elements[i]}.svg`,
        })),
      }))
  },
}
