import { motion } from 'motion/react';
import { Sidebar } from '@/components/layout/sidebar';
import { SettingsContent } from './preferences-page';

export function SettingsPage() {
  return (
    <div className="relative flex h-full w-full bg-page">
      <a href="#settings-main" data-skip-link className="skip-link">
        Settings
      </a>
      <Sidebar />

      <main
        id="settings-main"
        className="ml-16 flex-1 overflow-y-auto px-6 pt-8 pb-12 sm:px-8 md:ml-64 md:px-10 md:pt-12 lg:px-12"
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <SettingsContent />
        </motion.div>
      </main>
    </div>
  );
}
