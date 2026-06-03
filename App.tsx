import { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, SafeAreaView, StatusBar } from 'react-native';
import ReportScreen from './screens/ReportScreen';
import MapScreen from './screens/MapScreen';
import PanicScreen from './screens/PanicScreen';

type Tab = 'map' | 'report' | 'panic';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#080C18" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>⚔️ SENTINEL</Text>
        <Text style={styles.tagline}>Community Intelligence</Text>
      </View>

      {/* Screen */}
      <View style={styles.screen}>
        {activeTab === 'map' && <MapScreen />}
        {activeTab === 'report' && <ReportScreen onSuccess={() => setActiveTab('map')} />}
        {activeTab === 'panic' && <PanicScreen />}
      </View>

      {/* Bottom Nav */}
      <View style={styles.nav}>
        <TouchableOpacity style={[styles.navItem, activeTab === 'map' && styles.navActive]} onPress={() => setActiveTab('map')}>
          <Text style={styles.navIcon}>🗺️</Text>
          <Text style={[styles.navLabel, activeTab === 'map' && styles.navLabelActive]}>Live Map</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.navItem, styles.panicBtn]} onPress={() => setActiveTab('panic')}>
          <Text style={styles.panicIcon}>🆘</Text>
          <Text style={styles.panicLabel}>PANIC</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.navItem, activeTab === 'report' && styles.navActive]} onPress={() => setActiveTab('report')}>
          <Text style={styles.navIcon}>📋</Text>
          <Text style={[styles.navLabel, activeTab === 'report' && styles.navLabelActive]}>Report</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080C18' },
  header: {
    backgroundColor: '#0D1220',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: { color: '#EF4444', fontWeight: '700', fontSize: 18, letterSpacing: 3 },
  tagline: { color: 'rgba(255,255,255,0.3)', fontSize: 11, letterSpacing: 1 },
  screen: { flex: 1 },
  nav: {
    flexDirection: 'row',
    backgroundColor: '#0D1220',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingBottom: 8,
    paddingTop: 8,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  navItem: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 4 },
  navActive: { opacity: 1 },
  navIcon: { fontSize: 22 },
  navLabel: { color: 'rgba(255,255,255,0.3)', fontSize: 10, marginTop: 3, letterSpacing: 1 },
  navLabelActive: { color: '#3B82F6' },
  panicBtn: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
    borderRadius: 50,
    width: 70,
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  panicIcon: { fontSize: 26 },
  panicLabel: { color: '#EF4444', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
});
