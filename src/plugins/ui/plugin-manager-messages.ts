import type { AppLocale } from '@/i18n';

export interface PluginManagerMessages {
  readonly title: string;
  readonly eyebrow: string;
  readonly close: string;
  readonly addTitle: string;
  readonly githubPlaceholder: string;
  readonly add: string;
  readonly installing: string;
  readonly installHelp: string;
  readonly empty: string;
  readonly bundled: string;
  readonly github: string;
  readonly active: string;
  readonly inactive: string;
  readonly pendingRestart: string;
  readonly enable: string;
  readonly disable: string;
  readonly remove: string;
  readonly restore: string;
  readonly permissions: string;
  readonly grant: string;
  readonly risk: string;
  readonly restart: string;
  readonly installed: (name: string) => string;
  readonly enabled: (name: string) => string;
  readonly disabled: (name: string) => string;
  readonly removed: (name: string) => string;
  readonly failed: (message: string) => string;
}

export const PLUGIN_MANAGER_MESSAGES: Record<AppLocale, PluginManagerMessages> = {
  en: {
    title: 'Plugin manager',
    eyebrow: 'Host extensions',
    close: 'Close',
    addTitle: 'Add a GitHub plugin',
    githubPlaceholder: 'https://github.com/owner/plugin-repository',
    add: 'Add plugin',
    installing: 'Reading repository…',
    installHelp: 'The repository must expose noir.plugin.json and a bundled ESM entry. Review permissions before enabling it.',
    empty: 'No plugins are installed.',
    bundled: 'Built-in',
    github: 'GitHub',
    active: 'Active',
    inactive: 'Inactive',
    pendingRestart: 'Restart required',
    enable: 'Enable',
    disable: 'Disable',
    remove: 'Remove',
    restore: 'Restore default',
    permissions: 'Permissions',
    grant: 'Grant',
    risk: 'I acknowledge this high-risk capability',
    restart: 'Restart Noir Player',
    installed: (name) => `${name} was added. Restart Noir Player to load its code.`,
    enabled: (name) => `${name} enabled.`,
    disabled: (name) => `${name} disabled.`,
    removed: (name) => `${name} removed.`,
    failed: (message) => `Plugin operation failed: ${message}`,
  },
  es: {
    title: 'Administrador de plugins',
    eyebrow: 'Extensiones del host',
    close: 'Cerrar',
    addTitle: 'Agregar plugin desde GitHub',
    githubPlaceholder: 'https://github.com/usuario/repositorio-plugin',
    add: 'Agregar plugin',
    installing: 'Leyendo repositorio…',
    installHelp: 'El repositorio debe exponer noir.plugin.json y una entrada ESM empaquetada. Revisa los permisos antes de activarlo.',
    empty: 'No hay plugins instalados.',
    bundled: 'Incluido',
    github: 'GitHub',
    active: 'Activo',
    inactive: 'Inactivo',
    pendingRestart: 'Requiere reinicio',
    enable: 'Activar',
    disable: 'Desactivar',
    remove: 'Eliminar',
    restore: 'Restaurar defecto',
    permissions: 'Permisos',
    grant: 'Conceder',
    risk: 'Acepto esta capacidad de alto riesgo',
    restart: 'Reiniciar Noir Player',
    installed: (name) => `${name} fue agregado. Reinicia Noir Player para cargar su código.`,
    enabled: (name) => `${name} activado.`,
    disabled: (name) => `${name} desactivado.`,
    removed: (name) => `${name} eliminado.`,
    failed: (message) => `Falló la operación del plugin: ${message}`,
  },
  zh: {
    title: '插件管理器',
    eyebrow: '主机扩展',
    close: '关闭',
    addTitle: '从 GitHub 添加插件',
    githubPlaceholder: 'https://github.com/owner/plugin-repository',
    add: '添加插件',
    installing: '正在读取仓库…',
    installHelp: '仓库必须提供 noir.plugin.json 和打包后的 ESM 入口。启用前请检查权限。',
    empty: '尚未安装插件。',
    bundled: '内置',
    github: 'GitHub',
    active: '已启用',
    inactive: '已停用',
    pendingRestart: '需要重启',
    enable: '启用',
    disable: '停用',
    remove: '移除',
    restore: '恢复默认',
    permissions: '权限',
    grant: '授予',
    risk: '我确认此高风险能力',
    restart: '重启 Noir Player',
    installed: (name) => `${name} 已添加。重启 Noir Player 以加载代码。`,
    enabled: (name) => `${name} 已启用。`,
    disabled: (name) => `${name} 已停用。`,
    removed: (name) => `${name} 已移除。`,
    failed: (message) => `插件操作失败：${message}`,
  },
};
