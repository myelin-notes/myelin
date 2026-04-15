import { motion } from 'motion/react';
import { Sidebar } from '@/components/layout/sidebar';
import { PreferencesTab } from './preferences-tab';

export function SettingsPage() {
  return (
    <div className="relative flex h-full w-full bg-page">
      <Sidebar />

      <main className="ml-64 flex-1 overflow-y-auto px-12 pt-12 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <PreferencesTab />
        </motion.div>
      </main>
    </div>
  );
}
