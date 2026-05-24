# Script to update admin page.tsx with ranking tab
import os

filepath = os.path.join(os.path.dirname(__file__), '..', 'src', 'app', '[slug]', 'admin', 'page.tsx')
filepath = os.path.normpath(filepath)

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add import
content = content.replace(
    "import AdminGroupManager from '@/components/AdminGroupManager'",
    "import AdminGroupManager from '@/components/AdminGroupManager'\nimport AdminMonthlyRanking from '@/components/AdminMonthlyRanking'"
)

# 2. Add 'ranking' to type union
old_type = "'horarios' | 'usuarios' | 'config' | 'reporte' | 'ausentes' | 'exhibidores' | 'grupos' | 'excel' | 'reset' | 'historial'"
new_type = "'horarios' | 'usuarios' | 'config' | 'reporte' | 'ranking' | 'ausentes' | 'exhibidores' | 'grupos' | 'excel' | 'reset' | 'historial'"
content = content.replace(old_type, new_type)

# 3. Add ranking button after Reporte button
old_btn = "            📋 Reporte\n          </button>\n          <button\n            onClick={() => setActiveTab('ausentes')}"
new_btn = """            📋 Reporte
          </button>
          <button
            onClick={() => setActiveTab('ranking')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === 'ranking'
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            🏆 Ranking
          </button>
          <button
            onClick={() => setActiveTab('ausentes')}"""
content = content.replace(old_btn, new_btn)

# 4. Add rendering
old_render = "        {activeTab === 'reporte'    && <AdminWeekReport />}"
new_render = "        {activeTab === 'reporte'    && <AdminWeekReport />}\n        {activeTab === 'ranking'   && <AdminMonthlyRanking />}"
content = content.replace(old_render, new_render)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print('✅ page.tsx actualizado correctamente')