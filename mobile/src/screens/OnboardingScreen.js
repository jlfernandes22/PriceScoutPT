import React, { useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Text, Button, Avatar, IconButton } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    title: 'Catálogo Offline',
    icon: 'database-sync',
    description: 'O PriceScoutPT descarrega e guarda o catálogo de produtos no seu telemóvel para que possa pesquisar preços de forma ultra-rápida, mesmo sem internet e sem gastar dados móveis!',
    color: colors.primary,
  },
  {
    title: 'Comparador de Cabaz',
    icon: 'cart-arrow-down',
    description: 'Adicione os seus produtos diários ao cabaz. O nosso motor inteligente de Fuzzy-Matching Jaccard calcula e descobre instantaneamente qual é o supermercado local mais barato para si!',
    color: colors.success,
  },
  {
    title: 'Histórico e Promoções',
    icon: 'chart-bell-curve-cumulative',
    description: 'Evite falsas promoções! Consulte o histórico real da evolução de preços dos últimos 30 dias em gráficos lineares detalhados e compre com total transparência e poupança.',
    color: colors.danger,
  },
];

const OnboardingScreen = ({ onComplete }) => {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = () => {
    if (currentSlide < SLIDES.length - 1) {
      setCurrentSlide(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    try {
      await AsyncStorage.setItem('@onboarding_completed', 'true');
      onComplete();
    } catch (e) {
      console.error("[Onboarding AsyncStorage Error]:", e);
      // Fallback
      onComplete();
    }
  };

  const activeSlide = SLIDES[currentSlide];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.slideContainer}>
        {/* Ícone de Destaque Animado / Estético */}
        <Avatar.Icon 
          icon={activeSlide.icon} 
          size={120} 
          backgroundColor={activeSlide.color} 
          color={colors.surface} 
          style={styles.icon}
        />
        
        {/* Título */}
        <Text variant="headlineMedium" style={[styles.title, { color: activeSlide.color }]} accessibilityRole="header">
          {activeSlide.title}
        </Text>
        
        {/* Descrição */}
        <Text variant="bodyLarge" style={styles.description}>
          {activeSlide.description}
        </Text>
      </View>

      {/* Indicadores de Slide (Dots) */}
      <View
        style={styles.dotsRow}
        accessible
        accessibilityLabel={`Página ${currentSlide + 1} de ${SLIDES.length}: ${activeSlide.title}`}
        importantForAccessibility="yes"
      >
        {SLIDES.map((_, index) => (
          <View 
            key={index} 
            style={[
              styles.dot, 
              { backgroundColor: index === currentSlide ? activeSlide.color : colors.border },
              index === currentSlide ? styles.activeDot : null
            ]} 
            accessible={false}
          />
        ))}
      </View>

      {/* Barra de Ações Inferior */}
      <View style={styles.footerRow}>
        {currentSlide < SLIDES.length - 1 ? (
          <>
            <Button 
              mode="text" 
              textColor={colors.textMuted} 
              onPress={handleComplete}
              style={styles.skipButton}
            >
              Saltar
            </Button>
            <Button 
              mode="contained" 
              buttonColor={activeSlide.color} 
              textColor={colors.surface}
              onPress={handleNext}
              style={styles.actionButton}
            >
              Seguinte
            </Button>
          </>
        ) : (
          <Button 
            mode="contained" 
            buttonColor={activeSlide.color} 
            textColor={colors.surface} 
            onPress={handleComplete}
            style={styles.fullActionButton}
            icon="rocket-launch"
          >
            Começar a Poupar
          </Button>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
    paddingVertical: 24,
  },
  slideContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: 40,
  },
  icon: {
    marginBottom: 32,
    elevation: 4,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    color: colors.textSecondary,
    lineHeight: 24,
    paddingHorizontal: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  activeDot: {
    width: 20,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    minHeight: 48,
  },
  skipButton: {
    minWidth: 80,
  },
  actionButton: {
    minWidth: 120,
    borderRadius: 24,
  },
  fullActionButton: {
    flex: 1,
    borderRadius: 24,
    marginHorizontal: 8,
  },
});

export default OnboardingScreen;
