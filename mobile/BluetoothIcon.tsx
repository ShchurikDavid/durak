import React from 'react';
import { View } from 'react-native';
import { colors } from './styles';

// Standard Bluetooth symbol, drawn as lines so its shape does not depend on the font.
const strokes = [
  [12, 2, 12, 22],
  [12, 2, 18, 7],
  [18, 7, 6, 17],
  [6, 7, 18, 17],
  [18, 17, 12, 22]
];

export function BluetoothIcon() {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: 24, height: 24 }}
    >
      {strokes.map(([x1, y1, x2, y2], index) => {
        const length = Math.hypot(x2 - x1, y2 - y1);
        return (
          <View
            key={index}
            style={{
              position: 'absolute',
              left: (x1 + x2 - length) / 2,
              top: (y1 + y2) / 2 - 1,
              width: length,
              height: 2,
              borderRadius: 1,
              backgroundColor: colors.cream,
              transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }]
            }}
          />
        );
      })}
    </View>
  );
}
