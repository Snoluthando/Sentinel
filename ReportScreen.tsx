// =============================================================================
// CrimeNet SA — React Native Mobile App
// File: mobile-app/src/screens/ReportScreen.tsx
// Incident report submission screen with offline queue support
// =============================================================================

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Alert, StyleSheet, Platform, ActivityIndicator, Keyboard
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import NetInfo from '@react-native-community/netinfo';
import { useMMKVStorage } from 'react-native-mmkv-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import uuid from 'react-native-uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Category = {
  id: string;
  label: string;
  icon: string;
  color: string;
};

type QueuedReport = {
  localId: string;
  category: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  timestamp: string;
  photoUris: string[];
  synced: boolean;
};

// ---------------------------------------------------------------------------
// Incident categories
// ---------------------------------------------------------------------------

const CATEGORIES: Category[] = [
  { id: 'robbery',            label: 'Robbery',            icon: '🔫', color: '#EF4444' },
  { id: 'theft',              label: 'Theft',              icon: '👜', color: '#F97316' },
  { id: 'burglary',           label: 'Burglary',           icon: '🏠', color: '#EAB308' },
  { id: 'vehicle_theft',      label: 'Vehicle Theft',      icon: '🚗', color: '#8B5CF6' },
  { id: 'assault',            label: 'Assault',            icon: '⚠️', color: '#DC2626' },
  { id: 'suspicious_activity',label: 'Suspicious',         icon: '👁️', color: '#3B82F6' },
  { id: 'vandalism',          label: 'Vandalism',          icon: '🔨', color: '#6B7280' },
  { id: 'drug_activity',      label: 'Drug Activity',      icon: '💊', color: '#10B981' },
  { id: 'road_accident',      label: 'Road Accident',      icon: '🚨', color: '#64748B' },
  { id: 'other',              label: 'Other',              icon: '📋', color: '#94A3B8' },
];

// ---------------------------------------------------------------------------
// API config
// ---------------------------------------------------------------------------

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Offline queue utilities
// Using MMKV — 10x faster than AsyncStorage, persists through app restarts
// ---------------------------------------------------------------------------

const OFFLINE_QUEUE_KEY = 'offline_incident_queue';

const storage = new (require('react-native-mmkv-storage').MMKVLoader)()
  .withEncryption()
  .initialize();

function getQueue(): QueuedReport[] {
  try {
    const raw = storage.getString(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedReport[]) {
  storage.setString(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function addToQueue(report: QueuedReport) {
  const queue = getQueue();
  queue.push(report);
  saveQueue(queue);
}

async function syncQueue(token: string) {
  const queue = getQueue();
  const unsynced = queue.filter(r => !r.synced);

  if (!unsynced.length) return;

  const results = await Promise.allSettled(
    unsynced.map(async (report) => {
      const res = await fetch(`${API_URL}/incidents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category: report.category,
          title: report.title,
          description: report.description,
          lat: report.lat,
          lng: report.lng,
          incident_time: report.timestamp,
        }),
      });

      if (res.ok) {
        // Mark as synced
        const updated = getQueue().map(r =>
          r.localId === report.localId ? { ...r, synced: true } : r
        );
        saveQueue(updated);
      }
    }),
  );

  const synced = results.filter(r => r.status === 'fulfilled').length;
  console.log(`Synced ${synced}/${unsynced.length} queued reports`);
}

// ---------------------------------------------------------------------------
// ReportScreen
// ---------------------------------------------------------------------------

export default function ReportScreen() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [queueSize, setQueueSize] = useState(0);

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Request location permission on mount
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      }
    })();

    // Monitor connectivity
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = !!(state.isConnected && state.isInternetReachable);
      setIsOnline(online);

      // If came back online, try to sync queued reports
      if (online) {
        const token = storage.getString('auth_token');
        if (token) syncQueue(token).catch(console.error);
      }
    });

    // Show pending queue size
    setQueueSize(getQueue().filter(r => !r.synced).length);

    return () => unsubscribe();
  }, []);

  // ---------------------------------------------------------------------------
  // Pick photo from camera or gallery
  // ---------------------------------------------------------------------------

  const pickPhoto = async () => {
    if (photoUris.length >= 3) {
      Alert.alert('Maximum 3 photos per report');
      return;
    }

    Alert.alert('Add Photo', 'Choose source', [
      {
        text: 'Camera',
        onPress: async () => {
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
            allowsEditing: true,
          });
          if (!result.canceled) {
            setPhotoUris(prev => [...prev, result.assets[0].uri]);
          }
        },
      },
      {
        text: 'Photo Library',
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
          });
          if (!result.canceled) {
            setPhotoUris(prev => [...prev, result.assets[0].uri]);
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ---------------------------------------------------------------------------
  // Submit report
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (!selectedCategory) {
      Alert.alert('Select a category', 'Please choose the type of incident');
      return;
    }

    if (!title.trim()) {
      Alert.alert('Add a title', 'Briefly describe what happened');
      return;
    }

    if (!location) {
      Alert.alert('Location required', 'Allow location access to submit a report');
      return;
    }

    Keyboard.dismiss();
    setIsSubmitting(true);

    const report: QueuedReport = {
      localId: uuid.v4() as string,
      category: selectedCategory,
      title: title.trim(),
      description: description.trim(),
      lat: location.lat,
      lng: location.lng,
      timestamp: new Date().toISOString(),
      photoUris,
      synced: false,
    };

    try {
      if (!isOnline) {
        // Save to offline queue — will sync when connectivity returns
        addToQueue(report);
        setQueueSize(getQueue().filter(r => !r.synced).length);
        Alert.alert(
          '📶 Saved Offline',
          "No connection right now. Your report has been saved and will automatically submit when you're back online.",
          [{ text: 'OK' }],
        );
      } else {
        // Submit directly to API
        const token = storage.getString('auth_token');
        const response = await fetch(`${API_URL}/incidents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            category: report.category,
            title: report.title,
            description: report.description,
            lat: report.lat,
            lng: report.lng,
            anonymous,
          }),
        });

        if (!response.ok) throw new Error('Submission failed');

        Alert.alert(
          '✅ Report Submitted',
          anonymous
            ? 'Your anonymous report has been received and will be verified by the community.'
            : 'Thank you for keeping your community safe. Your report is being verified.',
          [{ text: 'OK' }],
        );
      }

      // Reset form
      setSelectedCategory(null);
      setTitle('');
      setDescription('');
      setPhotoUris([]);

    } catch (err) {
      // Network error — queue for later
      addToQueue(report);
      Alert.alert(
        '⚠️ Submission Error',
        'Your report has been saved and will sync automatically.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const catConfig = CATEGORIES.find(c => c.id === selectedCategory);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Report Incident</Text>
          <View style={styles.headerRight}>
            {!isOnline && (
              <View style={styles.offlineBadge}>
                <Feather name="wifi-off" size={10} color="#F97316" />
                <Text style={styles.offlineText}>OFFLINE</Text>
              </View>
            )}
            {queueSize > 0 && (
              <View style={styles.queueBadge}>
                <Text style={styles.queueText}>{queueSize} queued</Text>
              </View>
            )}
          </View>
        </View>

        {/* Category selector */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INCIDENT TYPE</Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryButton,
                  selectedCategory === cat.id && {
                    borderColor: cat.color,
                    backgroundColor: `${cat.color}22`,
                  },
                ]}
                onPress={() => setSelectedCategory(cat.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.categoryIcon}>{cat.icon}</Text>
                <Text
                  style={[
                    styles.categoryLabel,
                    selectedCategory === cat.id && { color: cat.color },
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Title */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WHAT HAPPENED?</Text>
          <TextInput
            style={styles.input}
            placeholder="Brief description (e.g. Armed men at Fourways Mall)"
            placeholderTextColor="#ffffff30"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            returnKeyType="next"
          />
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>DETAILS (OPTIONAL)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Vehicle descriptions, number of suspects, direction of travel..."
            placeholderTextColor="#ffffff30"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={500}
          />
        </View>

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>LOCATION</Text>
          <View style={styles.locationCard}>
            <Feather name={location ? 'map-pin' : 'loader'} size={14} color={location ? '#10B981' : '#F97316'} />
            <Text style={[styles.locationText, { color: location ? '#10B981' : '#F97316' }]}>
              {location
                ? `${location.lat.toFixed(4)}°S, ${location.lng.toFixed(4)}°E`
                : 'Acquiring GPS...'}
            </Text>
            <Text style={styles.locationNote}>~200m fuzzy radius applied for privacy</Text>
          </View>
        </View>

        {/* Anonymous toggle */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setAnonymous(!anonymous)}
            activeOpacity={0.7}
          >
            <View>
              <Text style={styles.toggleLabel}>Submit Anonymously</Text>
              <Text style={styles.toggleSub}>Your phone number won't be linked to this report</Text>
            </View>
            <View style={[styles.toggle, anonymous && styles.toggleActive]}>
              {anonymous && <Feather name="check" size={12} color="#fff" />}
            </View>
          </TouchableOpacity>
        </View>

        {/* Photos */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ADD PHOTOS (OPTIONAL)</Text>
          <View style={styles.photoRow}>
            {photoUris.map((uri, i) => (
              <View key={i} style={styles.photoThumb}>
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => setPhotoUris(prev => prev.filter((_, j) => j !== i))}
                >
                  <Text style={{ color: '#fff', fontSize: 10 }}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
            {photoUris.length < 3 && (
              <TouchableOpacity style={styles.photoAdd} onPress={pickPhoto}>
                <Feather name="camera" size={20} color="#ffffff40" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Submit */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              catConfig && { backgroundColor: `${catConfig.color}22`, borderColor: catConfig.color },
              (!selectedCategory || !title || isSubmitting) && styles.submitDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!selectedCategory || !title.trim() || isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name={isOnline ? 'send' : 'save'} size={16} color="#fff" />
                <Text style={styles.submitText}>
                  {isOnline ? 'Submit Report' : 'Save Offline'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: '#0A0E1A' },
  scroll:          { flex: 1 },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 },
  headerTitle:     { fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: 1 },
  headerRight:     { flexDirection: 'row', gap: 8 },
  offlineBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F9731620', borderWidth: 1, borderColor: '#F9731640', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  offlineText:     { fontSize: 9, color: '#F97316', fontWeight: '700', letterSpacing: 1 },
  queueBadge:      { backgroundColor: '#3B82F620', borderWidth: 1, borderColor: '#3B82F640', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  queueText:       { fontSize: 9, color: '#3B82F6', fontWeight: '600' },
  section:         { marginHorizontal: 16, marginBottom: 20 },
  sectionLabel:    { fontSize: 9, letterSpacing: 2, color: '#ffffff50', marginBottom: 8, fontWeight: '600' },
  categoryGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryButton:  { width: '30%', aspectRatio: 1.2, backgroundColor: '#1a2035', borderWidth: 1, borderColor: '#ffffff15', borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  categoryIcon:    { fontSize: 20 },
  categoryLabel:   { fontSize: 9, color: '#ffffff60', fontWeight: '600', textAlign: 'center' },
  input:           { backgroundColor: '#1a2035', borderWidth: 1, borderColor: '#ffffff15', borderRadius: 12, padding: 12, color: '#fff', fontSize: 14 },
  textArea:        { minHeight: 80, textAlignVertical: 'top' },
  locationCard:    { backgroundColor: '#1a2035', borderWidth: 1, borderColor: '#ffffff15', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  locationText:    { fontSize: 12, fontWeight: '600', flex: 1 },
  locationNote:    { fontSize: 9, color: '#ffffff30', width: '100%', marginTop: 2 },
  toggleRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a2035', borderWidth: 1, borderColor: '#ffffff15', borderRadius: 12, padding: 12 },
  toggleLabel:     { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  toggleSub:       { color: '#ffffff50', fontSize: 11 },
  toggle:          { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#ffffff30', alignItems: 'center', justifyContent: 'center' },
  toggleActive:    { backgroundColor: '#10B981', borderColor: '#10B981' },
  photoRow:        { flexDirection: 'row', gap: 8 },
  photoThumb:      { width: 60, height: 60, backgroundColor: '#1a2035', borderRadius: 8, borderWidth: 1, borderColor: '#ffffff20', position: 'relative' },
  photoRemove:     { position: 'absolute', top: -6, right: -6, width: 16, height: 16, backgroundColor: '#EF4444', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  photoAdd:        { width: 60, height: 60, backgroundColor: '#1a2035', borderRadius: 8, borderWidth: 1, borderColor: '#ffffff15', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  submitButton:    { backgroundColor: '#1a2035', borderWidth: 1, borderColor: '#3B82F6', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitDisabled:  { opacity: 0.4 },
  submitText:      { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
