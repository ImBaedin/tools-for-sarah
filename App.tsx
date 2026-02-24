import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';

type Screen = 'tools' | 'foodWastePreventer';

type MealEntry = {
  id: string;
  name: string;
  hour: number;
  minute: number;
  notificationId: string;
  createdAt: number;
};

type ActiveAlarm = {
  mealId: string;
  mealName: string;
};

const STORAGE_KEY = 'foodWastePreventer:meals:v1';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function parseTime(raw: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('tools');
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [mealName, setMealName] = useState('');
  const [dailyTime, setDailyTime] = useState('18:00');
  const [activeAlarm, setActiveAlarm] = useState<ActiveAlarm | null>(null);
  const [alarmSentence, setAlarmSentence] = useState('');
  const vibrationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const setupNotifications = async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        if (requested.status !== 'granted') {
          Alert.alert(
            'Notifications are off',
            'Enable notifications so daily meal reminders can ring like alarms.'
          );
        }
      }

      await Notifications.setNotificationChannelAsync('food-reminders', {
        name: 'Food Reminders',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 800, 300, 800],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });

      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        setMeals(JSON.parse(raw) as MealEntry[]);
      }

      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      const data = lastResponse?.notification.request.content.data as
        | { mealId?: string; mealName?: string }
        | undefined;
      if (data?.mealId && data.mealName) {
        setActiveAlarm({ mealId: data.mealId, mealName: data.mealName });
      }
    };

    void setupNotifications();
  }, []);

  useEffect(() => {
    const persist = async () => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(meals));
    };
    void persist();
  }, [meals]);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as { mealId?: string; mealName?: string };
      if (!data.mealId || !data.mealName) {
        return;
      }
      setActiveAlarm({ mealId: data.mealId, mealName: data.mealName });
      setScreen('foodWastePreventer');
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as {
          mealId?: string;
          mealName?: string;
        };
        if (!data.mealId || !data.mealName) {
          return;
        }
        setActiveAlarm({ mealId: data.mealId, mealName: data.mealName });
        setScreen('foodWastePreventer');
      }
    );

    return () => {
      subscription.remove();
      responseSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!activeAlarm) {
      if (vibrationIntervalRef.current) {
        clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = null;
      }
      Vibration.cancel();
      setAlarmSentence('');
      return;
    }

    Vibration.vibrate(1000);
    vibrationIntervalRef.current = setInterval(() => {
      Vibration.vibrate(1000);
    }, 1500);

    return () => {
      if (vibrationIntervalRef.current) {
        clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = null;
      }
      Vibration.cancel();
    };
  }, [activeAlarm]);

  const addMeal = useCallback(async () => {
    const trimmedName = mealName.trim();
    if (!trimmedName) {
      Alert.alert('Meal required', 'Enter a meal name like Tuna casserole.');
      return;
    }

    const parsedTime = parseTime(dailyTime);
    if (!parsedTime) {
      Alert.alert('Time format', 'Use 24h HH:MM format, for example 18:30.');
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Food Waste Preventer',
        body: `Use your ${trimmedName} today.`,
        sound: 'default',
        data: { mealId: id, mealName: trimmedName },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: parsedTime.hour,
        minute: parsedTime.minute,
        channelId: 'food-reminders',
      },
    });

    const nextEntry: MealEntry = {
      id,
      name: trimmedName,
      hour: parsedTime.hour,
      minute: parsedTime.minute,
      notificationId,
      createdAt: Date.now(),
    };
    setMeals((prev) => [nextEntry, ...prev]);
    setMealName('');
  }, [dailyTime, mealName]);

  const cancelMealAlarm = useCallback(
    async (mealId: string) => {
      const target = meals.find((meal) => meal.id === mealId);
      if (!target) {
        return;
      }
      await Notifications.cancelScheduledNotificationAsync(target.notificationId);
      setMeals((prev) => prev.filter((meal) => meal.id !== mealId));
      if (activeAlarm?.mealId === mealId) {
        setActiveAlarm(null);
      }
    },
    [activeAlarm?.mealId, meals]
  );

  const requiredSentence = useMemo(() => {
    if (!activeAlarm) {
      return '';
    }
    return `my name is sarah and i will use the ${activeAlarm.mealName.toLowerCase()} today`;
  }, [activeAlarm]);

  const canAcknowledge = useMemo(() => {
    return alarmSentence.trim().toLowerCase() === requiredSentence;
  }, [alarmSentence, requiredSentence]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        {screen === 'tools' ? (
          <View style={styles.screen}>
            <Text style={styles.title}>Sarah&apos;s Tools</Text>
            <Pressable style={styles.toolItem} onPress={() => setScreen('foodWastePreventer')}>
              <Text style={styles.toolTitle}>1. Food Waste Preventer</Text>
              <Text style={styles.toolSubtitle}>Track meals and ring daily reminders.</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.screen}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Food Waste Preventer</Text>
              <Pressable onPress={() => setScreen('tools')}>
                <Text style={styles.backButton}>Back</Text>
              </Pressable>
            </View>

            <TextInput
              placeholder="Prepared meal name (e.g. tuna)"
              value={mealName}
              onChangeText={setMealName}
              style={styles.input}
            />
            <TextInput
              placeholder="Reminder time (HH:MM, 24h)"
              value={dailyTime}
              onChangeText={setDailyTime}
              style={styles.input}
            />
            <Pressable style={styles.addButton} onPress={() => void addMeal()}>
              <Text style={styles.addButtonText}>Add Daily Reminder</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>Active Meals</Text>
            <FlatList
              data={meals}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<Text style={styles.emptyText}>No meals yet.</Text>}
              renderItem={({ item }) => (
                <View style={styles.mealItem}>
                  <View>
                    <Text style={styles.mealName}>{item.name}</Text>
                    <Text style={styles.mealTime}>Daily at {formatTime(item.hour, item.minute)}</Text>
                  </View>
                  <Pressable
                    onPress={() => void cancelMealAlarm(item.id)}
                    style={styles.cancelItemButton}
                  >
                    <Text style={styles.cancelItemButtonText}>Cancel</Text>
                  </Pressable>
                </View>
              )}
            />
          </View>
        )}

        <Modal visible={Boolean(activeAlarm)} animationType="fade" transparent={false}>
          <View style={styles.modalRoot}>
            <Text style={styles.alarmTitle}>Alarm: Use This Food Today</Text>
            <Text style={styles.alarmMeal}>{activeAlarm?.mealName}</Text>
            <Text style={styles.alarmDescription}>
              Type this exactly to unlock: &quot;{requiredSentence}&quot;
            </Text>
            <TextInput
              value={alarmSentence}
              onChangeText={setAlarmSentence}
              placeholder="Type the sentence exactly"
              style={styles.alarmInput}
              autoCapitalize="none"
            />

            {canAcknowledge ? (
              <View style={styles.alarmActions}>
                <Pressable style={styles.dismissButton} onPress={() => setActiveAlarm(null)}>
                  <Text style={styles.dismissButtonText}>Dismiss For Now</Text>
                </Pressable>
                <Pressable
                  style={styles.cancelAlarmButton}
                  onPress={() => {
                    if (activeAlarm) {
                      void cancelMealAlarm(activeAlarm.mealId);
                    }
                  }}
                >
                  <Text style={styles.cancelAlarmButtonText}>Cancel This Alarm</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.lockedText}>Alarm locked until sentence matches.</Text>
            )}
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F6F8F5',
  },
  screen: {
    flex: 1,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#21332A',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    color: '#355C47',
    fontSize: 16,
    fontWeight: '600',
  },
  toolItem: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D5E1D8',
  },
  toolTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C2A23',
  },
  toolSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: '#4A5A50',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C9D5CB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#2F7047',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  sectionTitle: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '700',
    color: '#21332A',
  },
  emptyText: {
    color: '#5B685F',
    marginTop: 8,
  },
  mealItem: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D5E1D8',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  mealName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C2A23',
  },
  mealTime: {
    marginTop: 2,
    color: '#4A5A50',
  },
  cancelItemButton: {
    backgroundColor: '#F2D6D2',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cancelItemButtonText: {
    color: '#7A2D24',
    fontWeight: '700',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: '#220C0C',
    padding: 24,
    justifyContent: 'center',
  },
  alarmTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#FFD7D7',
    textAlign: 'center',
  },
  alarmMeal: {
    marginTop: 12,
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  alarmDescription: {
    marginTop: 16,
    color: '#F3CACA',
    textAlign: 'center',
    lineHeight: 22,
  },
  alarmInput: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#D68585',
    padding: 12,
    fontSize: 16,
  },
  lockedText: {
    marginTop: 12,
    textAlign: 'center',
    color: '#FFD7D7',
    fontWeight: '700',
  },
  alarmActions: {
    marginTop: 16,
    gap: 10,
  },
  dismissButton: {
    backgroundColor: '#2F7047',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dismissButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  cancelAlarmButton: {
    backgroundColor: '#9A3930',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelAlarmButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});
